/**
 * End-to-end checks that signing is enforced by the request pipeline (#752),
 * not just by the verifier in isolation — the wiring is where a signed-request
 * feature usually fails open.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';

import { createApp } from '../src/app.js';
import { NonceStore, signRequest } from '../src/request-signing.js';

const SIGNING_SECRET = 'ss_integration_secret';
const KEY_ID = 'key_integration';

function makeConfig(overrides = {}) {
  return {
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    credentialStorePath: ':memory:',
    auditLogPath: ':memory:',
    requestSigningEnabled: true,
    requestSigningEnforce: 'mutations',
    requestSigningMaxAgeSeconds: 300,
    ...overrides,
  };
}

const mockSoroban = {
  getIssuers: async () => ['GXXXXXX'],
  addIssuer: async () => {},
  removeIssuer: async () => {},
  pingAllContracts: async () => ({ identity: true, credential: true, reputation: true }),
};

const mockMetrics = { renderPrometheus: () => '# mock metrics' };

/**
 * An ApiKeyService stand-in that resolves one key and one signing secret.
 * `validateKey` returns a record so the pipeline populates `req.apiKeyId`,
 * which is what tells the verifier whose secret to use.
 */
function makeApiKeyService() {
  return {
    validateKey: async (token) =>
      token === 'test-admin-key'
        ? { id: KEY_ID, scopes: ['*'], tier: 'enterprise', status: 'active' }
        : null,
    getSigningSecret: async (id) => (id === KEY_ID ? SIGNING_SECRET : null),
    listKeys: async () => [],
    getKey: async () => null,
  };
}

async function withServer(config, run, appOverrides = {}) {
  const app = createApp({
    config,
    soroban: mockSoroban,
    metrics: mockMetrics,
    apiKeyService: makeApiKeyService(),
    nonceStore: new NonceStore({ ttlSeconds: 300 }),
    ...appOverrides,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    return await run(`http://localhost:${port}`, port);
  } finally {
    server.close();
  }
}

/** Send a request, signing it unless `sign: false`. */
async function send(baseUrl, {
  method = 'POST',
  path = '/credentials',
  body = JSON.stringify({ id: `cred-${crypto.randomUUID()}`, subject: 'alice' }),
  sign = true,
  secret = SIGNING_SECRET,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomUUID(),
} = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': 'test-admin-key',
  };

  if (sign) {
    headers['X-Signature'] = signRequest({ secret, method, path, timestamp, nonce, body });
    headers['X-Signature-Timestamp'] = String(timestamp);
    headers['X-Signature-Nonce'] = nonce;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body }),
  });

  return { response, body };
}

/**
 * Assert the request got past signature verification.
 *
 * These tests are about enforcement, so they deliberately do not assert the
 * handler's own status code — what matters is that the pipeline did not
 * reject the request as unsigned, missigned or replayed.
 */
async function assertPassedSigning(response) {
  if (![401, 409, 400].includes(response.status)) return;

  const payload = await response.clone().json().catch(() => ({}));
  assert.ok(
    !String(payload.code ?? '').startsWith('SIGNATURE'),
    `expected the request to pass signing, got ${response.status} ${payload.code}`,
  );
}

test('a correctly signed mutation passes signature verification', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const { response } = await send(baseUrl);
    await assertPassedSigning(response);
  });
});

test('an unsigned mutation is rejected when signing is enabled', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const { response } = await send(baseUrl, { sign: false });
    assert.equal(response.status, 401);

    const payload = await response.json();
    assert.equal(payload.code, 'SIGNATURE_REQUIRED');
  });
});

test('a mutation whose body was altered after signing is rejected', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const signedBody = JSON.stringify({ id: 'cred-tamper', subject: 'alice' });
    const tamperedBody = JSON.stringify({ id: 'cred-tamper', subject: 'mallory' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    const response = await fetch(`${baseUrl}/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key',
        'X-Signature': signRequest({
          secret: SIGNING_SECRET,
          method: 'POST',
          path: '/credentials',
          timestamp,
          nonce,
          body: signedBody,
        }),
        'X-Signature-Timestamp': String(timestamp),
        'X-Signature-Nonce': nonce,
      },
      body: tamperedBody,
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'SIGNATURE_INVALID');
  });
});

test('replaying a captured signed request is rejected', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const body = JSON.stringify({ id: 'cred-replay', subject: 'alice' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-admin-key',
      'X-Signature': signRequest({
        secret: SIGNING_SECRET,
        method: 'POST',
        path: '/credentials',
        timestamp,
        nonce,
        body,
      }),
      'X-Signature-Timestamp': String(timestamp),
      'X-Signature-Nonce': nonce,
    };

    const first = await fetch(`${baseUrl}/credentials`, { method: 'POST', headers, body });
    await assertPassedSigning(first);

    const replay = await fetch(`${baseUrl}/credentials`, { method: 'POST', headers, body });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).code, 'SIGNATURE_REPLAYED');
  });
});

test('a signature older than the configured window is rejected', async () => {
  await withServer(makeConfig({ requestSigningMaxAgeSeconds: 60 }), async (baseUrl) => {
    const { response } = await send(baseUrl, {
      timestamp: Math.floor(Date.now() / 1000) - 120,
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'SIGNATURE_EXPIRED');
  });
});

test('reads are unsigned under the default "mutations" enforcement', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/issuers`, {
      headers: { 'X-API-Key': 'test-admin-key' },
    });

    assert.notEqual(response.status, 401);
  });
});

test('reads require a signature when enforcement is set to "all"', async () => {
  await withServer(makeConfig({ requestSigningEnforce: 'all' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/issuers`, {
      headers: { 'X-API-Key': 'test-admin-key' },
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'SIGNATURE_REQUIRED');
  });
});

test('health probes stay reachable without a signature', async () => {
  // A probe has no client credentials, so requiring a signature would take
  // the deployment out of its load balancer the moment signing was enabled.
  await withServer(makeConfig({ requestSigningEnforce: 'all' }), async (baseUrl) => {
    for (const path of ['/info', '/live']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.notEqual(response.status, 401, `${path} should not require a signature`);
    }
  });
});

test('signing is off unless enabled, so existing clients keep working', async () => {
  await withServer(makeConfig({ requestSigningEnabled: false }), async (baseUrl) => {
    const { response } = await send(baseUrl, { sign: false });
    await assertPassedSigning(response);
  });
});
