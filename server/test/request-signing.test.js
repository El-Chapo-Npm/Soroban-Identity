import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';

import {
  DEFAULT_MAX_AGE_SECONDS,
  KEY_ID_HEADER,
  NONCE_HEADER,
  NonceStore,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  buildCanonicalString,
  hashBody,
  signRequest,
  verifySignedRequest,
} from '../src/request-signing.js';

const SECRET = 'ss_test_secret_value';

/**
 * Build the headers a well-behaved client would send, so each test can vary
 * exactly one thing and leave the rest valid.
 */
function signedHeaders({
  secret = SECRET,
  method = 'POST',
  path = '/credentials',
  body = '',
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomUUID(),
} = {}) {
  return {
    [SIGNATURE_HEADER]: signRequest({ secret, method, path, timestamp, nonce, body }),
    [TIMESTAMP_HEADER]: String(timestamp),
    [NONCE_HEADER]: nonce,
  };
}

function verify(overrides = {}) {
  const method = overrides.method ?? 'POST';
  const path = overrides.path ?? '/credentials';
  const body = overrides.body ?? '';
  return verifySignedRequest({
    method,
    path,
    body,
    secret: SECRET,
    nonceStore: overrides.nonceStore ?? new NonceStore(),
    headers: overrides.headers ?? signedHeaders({ method, path, body }),
    ...overrides,
  });
}

test('hashBody hashes an empty body as the SHA-256 of the empty string', () => {
  const expected = crypto.createHash('sha256').update('').digest('hex');
  assert.equal(hashBody(''), expected);
  assert.equal(hashBody(Buffer.alloc(0)), expected);
});

test('the canonical string covers method, path, timestamp, nonce and body', () => {
  const canonical = buildCanonicalString({
    method: 'post',
    path: '/credentials?limit=10',
    timestamp: 1700000000,
    nonce: 'abc',
    body: '{"a":1}',
  });

  assert.deepEqual(canonical.split('\n'), [
    'POST',
    '/credentials?limit=10',
    '1700000000',
    'abc',
    hashBody('{"a":1}'),
  ]);
});

test('a correctly signed request verifies', () => {
  assert.deepEqual(verify(), { ok: true });
});

test('a signature over a different body is rejected', () => {
  const headers = signedHeaders({ body: '{"amount":1}' });
  const result = verify({ headers, body: '{"amount":1000}' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_INVALID');
  assert.equal(result.status, 401);
});

test('a signature over a different path is rejected', () => {
  const headers = signedHeaders({ path: '/credentials' });
  const result = verify({ headers, path: '/admin/api-keys' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_INVALID');
});

test('a signature over a different method is rejected', () => {
  const headers = signedHeaders({ method: 'GET' });
  const result = verify({ headers, method: 'DELETE' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_INVALID');
});

test('a signature made with another secret is rejected', () => {
  const headers = signedHeaders({ secret: 'ss_someone_elses_secret' });
  const result = verify({ headers });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_INVALID');
});

test('missing signature headers are reported as such', () => {
  for (const header of [SIGNATURE_HEADER, TIMESTAMP_HEADER, NONCE_HEADER]) {
    const headers = signedHeaders();
    delete headers[header];

    const result = verify({ headers });
    assert.equal(result.ok, false, `${header} should be required`);
    assert.equal(result.code, 'SIGNATURE_REQUIRED');
  }
});

test('a request is rejected when no signing secret is registered for the key', () => {
  const result = verify({ secret: null });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNING_KEY_UNKNOWN');
});

test('an unsupported signature version is rejected rather than compared as v1', () => {
  const headers = signedHeaders();
  headers[SIGNATURE_HEADER] = headers[SIGNATURE_HEADER].replace('v1=', 'v2=');

  const result = verify({ headers });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_VERSION_UNSUPPORTED');
  assert.equal(result.status, 400);
});

test('a non-numeric timestamp is rejected', () => {
  const headers = signedHeaders();
  headers[TIMESTAMP_HEADER] = 'not-a-timestamp';

  const result = verify({ headers });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_TIMESTAMP_INVALID');
});

test('a request older than the max age is rejected', () => {
  const staleSeconds = Math.floor(Date.now() / 1000) - (DEFAULT_MAX_AGE_SECONDS + 60);
  const headers = signedHeaders({ timestamp: staleSeconds });

  const result = verify({ headers });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_EXPIRED');
});

test('a request just inside the max age is accepted', () => {
  const freshEnough = Math.floor(Date.now() / 1000) - (DEFAULT_MAX_AGE_SECONDS - 10);
  const headers = signedHeaders({ timestamp: freshEnough });

  assert.deepEqual(verify({ headers }), { ok: true });
});

test('a future-dated request beyond the skew allowance is rejected', () => {
  // Post-dating would otherwise let a captured signature stay valid for as
  // long as the attacker chose.
  const future = Math.floor(Date.now() / 1000) + DEFAULT_MAX_AGE_SECONDS + 60;
  const headers = signedHeaders({ timestamp: future });

  const result = verify({ headers });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_EXPIRED');
});

test('replaying an identical signed request is rejected', () => {
  const nonceStore = new NonceStore();
  const headers = signedHeaders();

  assert.deepEqual(verify({ headers, nonceStore }), { ok: true });

  const replay = verify({ headers, nonceStore });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'SIGNATURE_REPLAYED');
  assert.equal(replay.status, 409);
});

test('a failed signature does not consume the nonce', () => {
  // Otherwise an attacker could burn a client's nonces with garbage
  // signatures and lock out the requests that follow.
  const nonceStore = new NonceStore();
  const nonce = 'shared-nonce';

  const tampered = signedHeaders({ nonce, body: '{"a":1}' });
  const rejected = verify({ headers: tampered, body: '{"a":2}', nonceStore });
  assert.equal(rejected.code, 'SIGNATURE_INVALID');

  const genuine = signedHeaders({ nonce, body: '{"a":2}' });
  assert.deepEqual(verify({ headers: genuine, body: '{"a":2}', nonceStore }), { ok: true });
});

test('two clients may use the same nonce because it is scoped per key', () => {
  const nonceStore = new NonceStore();
  const nonce = 'collision';
  const headers = signedHeaders({ nonce });

  assert.deepEqual(verify({ headers, nonceStore, scope: 'key_a' }), { ok: true });
  assert.deepEqual(verify({ headers, nonceStore, scope: 'key_b' }), { ok: true });
});

test('NonceStore forgets entries once they fall outside the window', () => {
  let clock = 1_000_000;
  const store = new NonceStore({ ttlSeconds: 60, now: () => clock });

  assert.equal(store.consume('n1'), true);
  assert.equal(store.consume('n1'), false, 'still inside the window');

  // Past the TTL the timestamp check alone would reject a replay, so the
  // nonce no longer needs remembering.
  clock += 61_000;
  assert.equal(store.consume('n1'), true);
});

test('NonceStore refuses new nonces rather than evicting live ones when full', () => {
  const store = new NonceStore({ ttlSeconds: 60, maxEntries: 2 });

  assert.equal(store.consume('a'), true);
  assert.equal(store.consume('b'), true);
  // Failing closed keeps the replay window shut; evicting 'a' would reopen it.
  assert.equal(store.consume('c'), false);
  assert.equal(store.consume('a'), false, 'the earlier nonce is still protected');
});

test('the key id header is exported for callers signing with a non-authenticating key', () => {
  assert.equal(KEY_ID_HEADER, 'x-signature-key-id');
});
