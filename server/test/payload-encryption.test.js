import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import {
  decryptAesGcm,
  deriveSessionKey,
  encryptAesGcm,
  EncryptionSessionStore,
  requestAad,
  responseAad,
} from '../src/payload-encryption.js';

const makeClientKeyPair = () => crypto.generateKeyPairSync('x25519');
const publicKeyBase64 = (keyPair) =>
  keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function deriveClientSessionKey(clientPair, exchange) {
  const sharedSecret = crypto.diffieHellman({
    privateKey: clientPair.privateKey,
    publicKey: crypto.createPublicKey({
      key: Buffer.from(exchange.serverPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    }),
  });
  const key = deriveSessionKey(
    sharedSecret,
    Buffer.from(exchange.salt, 'base64'),
    exchange.sessionId,
    exchange.keyId,
  );
  sharedSecret.fill(0);
  return key;
}

test('session keys are client/server-derived, owner-bound, and rotate with a grace period', () => {
  let now = 1_000;
  const store = new EncryptionSessionStore({
    now: () => now,
    ttlSeconds: 600,
    rotationGraceSeconds: 30,
  });
  const client = makeClientKeyPair();
  const session = store.create(publicKeyBase64(client), 'client-a');
  const firstKey = deriveClientSessionKey(client, session);

  assert.deepEqual(store.getCurrentKey(session.sessionId, 'client-a').key, firstKey);
  assert.equal(store.getCurrentKey(session.sessionId, 'client-b'), null);

  const rotated = store.rotate(session.sessionId, publicKeyBase64(client), 'client-a');
  const nextKey = deriveClientSessionKey(client, rotated);
  assert.equal(rotated.generation, 2);
  assert.deepEqual(store.getKey(session.sessionId, session.keyId, 'client-a'), firstKey);
  assert.deepEqual(store.getKey(session.sessionId, rotated.keyId, 'client-a'), nextKey);

  now += 31_000;
  assert.equal(store.getKey(session.sessionId, session.keyId, 'client-a'), null);
  assert.deepEqual(store.getKey(session.sessionId, rotated.keyId, 'client-a'), nextKey);
});

test('AES-GCM rejects tampered authentication tags', () => {
  const key = crypto.randomBytes(32);
  const envelope = encryptAesGcm(key, 'sensitive value', Buffer.from('aad'));
  assert.equal(
    decryptAesGcm(key, { algorithm: 'A256GCM', ...envelope }, Buffer.from('aad')).toString(),
    'sensitive value',
  );
  assert.throws(
    () => decryptAesGcm(
      key,
      { algorithm: 'A256GCM', ...envelope, tag: Buffer.alloc(16).toString('base64') },
      Buffer.from('aad'),
    ),
    { code: 'ENCRYPTED_PAYLOAD_INVALID' },
  );
});

test('authenticated session encrypts credential response fields and decrypts encrypted requests', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'payload-encryption-'));
  const credentialStorePath = path.join(directory, 'credentials.json');
  await fs.writeFile(credentialStorePath, JSON.stringify({
    credentials: [{
      id: 'credential-1',
      subject: 'alice@example.test',
      issuer: 'issuer-1',
      claims: { legalName: 'Alice Example' },
      expiresAt: 0,
      revoked: false,
    }],
  }));

  const config = {
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    dataDir: directory,
    credentialStorePath,
    auditLogPath: path.join(directory, 'audit'),
    payloadEncryptionEnabled: true,
    payloadEncryptionSensitiveFields: ['subject', 'claims'],
  };
  const apiKeyService = {
    validateKey: async (token) => token === 'test-admin-key'
      ? { id: 'client-a', scopes: ['*'], tier: 'enterprise', status: 'active' }
      : null,
    listKeys: async () => [],
    getKey: async () => null,
  };
  const app = createApp({
    config,
    apiKeyService,
    soroban: {
      getIssuers: async () => [],
      addIssuer: async () => {},
      removeIssuer: async () => {},
      pingAllContracts: async () => ({ identity: true, credential: true, reputation: true }),
    },
    metrics: { renderPrometheus: () => '# mock metrics' },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://localhost:${server.address().port}`;
  const clientPair = makeClientKeyPair();
  const createResponse = await fetch(`${baseUrl}/encryption/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
    body: JSON.stringify({ clientPublicKey: publicKeyBase64(clientPair) }),
  });
  assert.equal(createResponse.status, 201);
  const session = await createResponse.json();
  const key = deriveClientSessionKey(clientPair, session);

  const readPath = '/credentials/credential-1';
  const encryptedRead = await fetch(`${baseUrl}${readPath}`, {
    headers: {
      'X-API-Key': 'test-admin-key',
      'X-Encryption-Session': session.sessionId,
    },
  });
  assert.equal(encryptedRead.status, 200);
  assert.equal(encryptedRead.headers.get('cache-control'), 'no-store');
  const credential = await encryptedRead.json();
  assert.equal(credential.subject.algorithm, 'A256GCM');
  assert.equal(credential.claims.algorithm, 'A256GCM');
  assert.equal(
    JSON.parse(decryptAesGcm(
      key,
      credential.subject,
      responseAad({
        method: 'GET',
        path: readPath,
        statusCode: 200,
        sessionId: session.sessionId,
        keyId: session.keyId,
        fieldPath: '/subject',
      }),
    ).toString()),
    'alice@example.test',
  );

  const writePath = '/credentials';
  const plaintext = JSON.stringify({
    id: 'credential-2',
    subject: 'bob@example.test',
    claims: { legalName: 'Bob Example' },
    issuer: 'issuer-1',
    expiresAt: 0,
    revoked: false,
  });
  const encryptedRequest = {
    algorithm: 'A256GCM',
    keyId: session.keyId,
    ...encryptAesGcm(
      key,
      plaintext,
      requestAad({ method: 'POST', url: writePath }, session.sessionId, session.keyId),
    ),
  };
  const writeResponse = await fetch(`${baseUrl}${writePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-admin-key',
      'X-Encryption-Session': session.sessionId,
    },
    body: JSON.stringify(encryptedRequest),
  });
  assert.equal(writeResponse.status, 201);
  const issued = await writeResponse.json();
  assert.equal(issued.subject.algorithm, 'A256GCM');

  const unencryptedRead = await fetch(`${baseUrl}${readPath}`);
  assert.equal(unencryptedRead.status, 428);
  assert.equal((await unencryptedRead.json()).code, 'ENCRYPTION_REQUIRED');
});
