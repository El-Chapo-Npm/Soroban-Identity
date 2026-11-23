import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { normalizeUnicodeString, sanitizeDidMetadata } from '../src/validation.js';

const ADDRESS = `G${'A'.repeat(55)}`;
const ADMIN_KEY = 'test-admin-key';
const LONE_HIGH = '\uD83D';
const LONE_LOW = '\uDE00';
const RICH = 'Ada 😀 李 👩‍💻 مرحبا é';

async function withServer(t, { chainMetadata = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'did-unicode-test-'));
  const soroban = {
    getIssuers: async () => [],
    pingAllContracts: async () => ({}),
    resolveDid: async (address) => ({
      id: `did:stellar:${address}`,
      controller: `did:stellar:${address}`,
      createdAt: 1,
      updatedAt: 1,
      metadata: chainMetadata,
      active: true,
    }),
  };
  const app = createApp({
    config: {
      adminApiKey: ADMIN_KEY,
      adminActor: 'admin',
      corsAllowedOrigins: ['*'],
      maxBodyBytes: 64 * 1024,
      dataDir: dir,
      credentialStorePath: path.join(dir, 'credentials.json'),
      auditLogPath: path.join(dir, 'audit'),
    },
    soroban,
    metrics: { renderPrometheus: () => '' },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  return `http://localhost:${server.address().port}`;
}

function postDid(base, body, headers = { 'X-API-Key': ADMIN_KEY }) {
  return fetch(`${base}/dids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('normalizeUnicodeString replaces lone surrogates and keeps valid Unicode', () => {
  assert.equal(normalizeUnicodeString(`a${LONE_HIGH}b${LONE_LOW}c`), 'a\uFFFDb\uFFFDc');
  assert.equal(normalizeUnicodeString(RICH), RICH.normalize('NFC'));
  // NFD "e + combining acute" is composed to the single NFC code point.
  assert.equal(normalizeUnicodeString('e\u0301'), '\u00e9');
});

test('sanitizeDidMetadata strips control characters but keeps tab and newline', () => {
  assert.deepEqual(sanitizeDidMetadata({ note: 'a\u0000b\u0007c\td\ne' }), { note: 'abc\td\ne' });
  assert.throws(() => sanitizeDidMetadata(['not', 'an', 'object']), TypeError);
});

test('DID writes require authentication', async (t) => {
  const base = await withServer(t);
  const created = await postDid(base, { address: ADDRESS, metadata: { name: 'x' } }, {});
  assert.equal(created.status, 401);

  const updated = await fetch(`${base}/dids/did:stellar:${ADDRESS}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { name: 'x' } }),
  });
  assert.equal(updated.status, 401);
});

test('POST /dids preserves rich Unicode metadata', async (t) => {
  const base = await withServer(t);
  const res = await postDid(base, { address: ADDRESS, metadata: { name: RICH } });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.metadata.name, RICH.normalize('NFC'));
});

test('POST /dids neutralises lone surrogates instead of failing with a 500', async (t) => {
  const base = await withServer(t);
  // JSON escapes keep the lone surrogates intact on the wire.
  const raw = `{"address":"${ADDRESS}","metadata":{"name":"x\\ud83dy","tag":"\\ude00"}}`;
  const res = await postDid(base, raw);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.metadata.name, 'x\uFFFDy');
  assert.equal(body.metadata.tag, '\uFFFD');
});

test('POST /dids rejects non-object metadata with a 400', async (t) => {
  const base = await withServer(t);
  const res = await postDid(base, { address: ADDRESS, metadata: ['a', 'b'] });
  assert.equal(res.status, 400);
});

test('PATCH /dids/:did merges sanitized Unicode metadata', async (t) => {
  const base = await withServer(t, { chainMetadata: { existing: 'kept' } });
  const res = await fetch(`${base}/dids/did:stellar:${ADDRESS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': ADMIN_KEY },
    body: `{"metadata":{"emoji":"😀","bad":"\\ud83d"}}`,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metadata, { existing: 'kept', emoji: '😀', bad: '\uFFFD' });
});

test('GET /dids/:did sanitizes malformed metadata read back from the chain', async (t) => {
  const base = await withServer(t, { chainMetadata: { name: `ok${LONE_HIGH}`, ctrl: 'a\u0000b' } });
  const res = await fetch(`${base}/dids/did:stellar:${ADDRESS}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metadata, { name: 'ok\uFFFD', ctrl: 'ab' });
  assert.ok(body._links.self.href.includes(ADDRESS));
});
