import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Test harness: a minimal in-process gateway that mirrors the production
// request pipeline (auth -> rate limit -> circuit breaker -> plugins -> proxy).
// The real gateway module is imported lazily so the harness can be swapped in
// tests without touching production code paths.
// ---------------------------------------------------------------------------

const UPSTREAM_PORT = 0; // ephemeral
let upstreamServer;
let upstreamBaseUrl;
let upstreamRequests = [];

function startUpstream() {
  return new Promise((resolve) => {
    upstreamServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        upstreamRequests.push({
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    upstreamServer.listen(UPSTREAM_PORT, '127.0.0.1', () => {
      const addr = upstreamServer.address();
      upstreamBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

function stopUpstream() {
  return new Promise((resolve) => {
    if (!upstreamServer) return resolve();
    upstreamServer.close(() => resolve());
  });
}

// ---------------------------------------------------------------------------
// Gateway under test. We build a fresh instance per test suite so that
// rate-limit counters and circuit-breaker state do not leak between tests.
// ---------------------------------------------------------------------------

async function createGateway(overrides = {}) {
  const { createGateway: factory } = await import('../../src/gateway/index.js');

  const config = {
    upstream: upstreamBaseUrl,
    auth: {
      apiKeys: {
        'key-tenant-a': { tenantId: 'tenant-a', scopes: ['read', 'write'] },
        'key-tenant-b': { tenantId: 'tenant-b', scopes: ['read'] },
      },
      oauth: {
        issuer: 'https://issuer.test',
        audience: 'gateway',
        // Static JWKS for deterministic verification in tests.
        jwks: {
          keys: [
            {
              kty: 'RSA',
              kid: 'test-key-1',
              use: 'sig',
              alg: 'RS256',
              n: TEST_JWK_N,
              e: TEST_JWK_E,
            },
          ],
        },
      },
    },
    rateLimit: {
      windowMs: 60_000,
      max: 5,
      keyBy: 'tenant',
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeoutMs: 200,
      halfOpenMaxCalls: 1,
    },
    plugins: [],
    ...overrides,
  };

  return factory(config);
}

// A throwaway RSA key pair generated at module load for OAuth tests.
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY } =
  crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const TEST_JWK = TEST_PUBLIC_KEY.export({ format: 'jwk' });
const TEST_JWK_N = TEST_JWK.n;
const TEST_JWK_E = TEST_JWK.e;

function signTestJwt({ sub = 'user-1', tenantId = 'tenant-a', scopes = ['read'], exp } = {}) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://issuer.test',
    aud: 'gateway',
    sub,
    tenant_id: tenantId,
    scope: scopes.join(' '),
    iat: now,
    exp: exp ?? now + 300,
  };

  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: TEST_PRIVATE_KEY,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  return `${signingInput}.${signature.toString('base64url')}`;
}

async function request(gateway, path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, gateway.baseUrl);
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gateway integration', () => {
  beforeAll(async () => {
    await startUpstream();
  });

  afterAll(async () => {
    await stopUpstream();
  });

  describe('authentication', () => {
    let gateway;

    beforeAll(async () => {
      gateway = await createGateway();
    });

    afterAll(async () => {
      await gateway.close();
    });

    it('rejects requests without credentials', async () => {
      const res = await request(gateway, '/api/resource');
      expect(res.status).toBe(401);
      expect(res.json?.error).toMatch(/unauthorized|missing/i);
    });

    it('accepts a valid API key and forwards tenant context upstream', async () => {
      upstreamRequests = [];
      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-tenant-a' },
      });

      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true, path: '/api/resource' });

      const forwarded = upstreamRequests.at(-1);
      expect(forwarded.headers['x-tenant-id']).toBe('tenant-a');
      expect(forwarded.headers['x-api-key']).toBeUndefined();
    });

    it('rejects an unknown API key', async () => {
      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-does-not-exist' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a valid OAuth bearer token', async () => {
      const token = signTestJwt({ tenantId: 'tenant-a' });
      const res = await request(gateway, '/api/resource', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('rejects an expired OAuth bearer token', async () => {
      const token = signTestJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
      const res = await request(gateway, '/api/resource', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a bearer token with a bad signature', async () => {
      const token = signTestJwt();
      const tampered = `${token.slice(0, -4)}AAAA`;
      const res = await request(gateway, '/api/resource', {
        headers: { authorization: `Bearer ${tampered}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a bearer token with the wrong audience', async () => {
      const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: 'https://issuer.test',
        aud: 'some-other-service',
        sub: 'user-1',
        tenant_id: 'tenant-a',
        exp: now + 300,
      };
      const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const signingInput = `${b64(header)}.${b64(payload)}`;
      const signature = crypto.sign('sha256', Buffer.from(signingInput), {
        key: TEST_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      });
      const token = `${signingInput}.${signature.toString('base64url')}`;

      const res = await request(gateway, '/api/resource', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('tenant-aware rate limiting', () => {
    let gateway;

    beforeAll(async () => {
      gateway = await createGateway({
        rateLimit: { windowMs: 60_000, max: 3, keyBy: 'tenant' },
      });
    });

    afterAll(async () => {
      await gateway.close();
    });

    it('limits each tenant independently', async () => {
      const tenantA = { 'x-api-key': 'key-tenant-a' };
      const tenantB = { 'x-api-key': 'key-tenant-b' };

      // Exhaust tenant-a's budget.
      for (let i = 0; i < 3; i += 1) {
        const res = await request(gateway, '/api/resource', { headers: tenantA });
        expect(res.status).toBe(200);
      }

      const blocked = await request(gateway, '/api/resource', { headers: tenantA });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBeTruthy();

      // tenant-b is unaffected by tenant-a's exhaustion.
      const other = await request(gateway, '/api/resource', { headers: tenantB });
      expect(other.status).toBe(200);
    });

    it('includes rate-limit headers on successful responses', async () => {
      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-tenant-b' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBe('3');
      expect(Number(res.headers.get('x-ratelimit-remaining'))).toBeGreaterThanOrEqual(0);
    });
  });

  describe('correlation ID propagation', () => {
    let gateway;

    beforeAll(async () => {
      gateway = await createGateway();
    });

    afterAll(async () => {
      await gateway.close();
    });

    it('generates a correlation ID when none is supplied', async () => {
      upstreamRequests = [];
      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-tenant-a' },
      });

      expect(res.status).toBe(200);
      const echoed = res.headers.get('x-correlation-id');
      expect(echoed).toBeTruthy();

      const forwarded = upstreamRequests.at(-1);
      expect(forwarded.headers['x-correlation-id']).toBe(echoed);
    });

    it('preserves a caller-supplied correlation ID', async () => {
      upstreamRequests = [];
      const correlationId = 'corr-abc-123';
      const res = await request(gateway, '/api/resource', {
        headers: {
          'x-api-key': 'key-tenant-a',
          'x-correlation-id': correlationId,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('x-correlation-id')).toBe(correlationId);

      const forwarded = upstreamRequests.at(-1);
      expect(forwarded.headers['x-correlation-id']).toBe(correlationId);
    });
  });

  describe('circuit breaker', () => {
    let gateway;
    let failingUpstream;
    let failingBaseUrl;

    beforeAll(async () => {
      failingUpstream = http.createServer((req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream boom' }));
      });
      await new Promise((resolve) => {
        failingUpstream.listen(0, '127.0.0.1', () => {
          failingBaseUrl = `http://127.0.0.1:${failingUpstream.address().port}`;
          resolve();
        });
      });

      gateway = await createGateway({
        upstream: failingBaseUrl,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 300,
          halfOpenMaxCalls: 1,
        },
      });
    });

    afterAll(async () => {
      await gateway.close();
      await new Promise((resolve) => failingUpstream.close(() => resolve()));
    });

    it('opens after repeated upstream failures and short-circuits', async () => {
      const headers = { 'x-api-key': 'key-tenant-a' };

      const first = await request(gateway, '/api/resource', { headers });
      expect(first.status).toBeGreaterThanOrEqual(500);

      const second = await request(gateway, '/api/resource', { headers });
      expect(second.status).toBeGreaterThanOrEqual(500);

      const third = await request(gateway, '/api/resource', { headers });
      expect(third.status).toBe(503);
      expect(third.json?.error).toMatch(/circuit|unavailable/i);
    });

    it('transitions to half-open and recovers when upstream heals', async () => {
      // Wait for the reset timeout to elapse.
      await new Promise((r) => setTimeout(r, 350));

      // Swap the failing upstream for a healthy one by pointing the gateway
      // at the healthy upstream base URL.
      gateway.setUpstream(upstreamBaseUrl);

      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-tenant-a' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('plugin execution order', () => {
    let gateway;
    const calls = [];

    beforeAll(async () => {
      const makePlugin = (name) => ({
        name,
        onRequest: vi.fn(async (ctx, next) => {
          calls.push(`${name}:request`);
          ctx.headers[`x-plugin-${name}`] = '1';
          await next();
        }),
        onResponse: vi.fn(async (ctx, next) => {
          calls.push(`${name}:response`);
          await next();
        }),
      });

      gateway = await createGateway({
        plugins: [makePlugin('first'), makePlugin('second'), makePlugin('third')],
      });
    });

    afterAll(async () => {
      await gateway.close();
    });

    it('runs request hooks in registration order and response hooks in reverse', async () => {
      calls.length = 0;
      upstreamRequests = [];

      const res = await request(gateway, '/api/resource', {
        headers: { 'x-api-key': 'key-tenant-a' },
      });

      expect(res.status).toBe(200);

      expect(calls).toEqual([
        'first:request',
        'second:request',
        'third:request',
        'third:response',
        'second:response',
        'first:response',
      ]);

      const forwarded = upstreamRequests.at(-1);
      expect(forwarded.headers['x-plugin-first']).toBe('1');
      expect(forwarded.headers['x-plugin-second']).toBe('1');
      expect(forwarded.headers['x-plugin-third']).toBe('1');
    });

    it('aborts the pipeline when a plugin throws', async () => {
      const aborting = {
        name: 'aborting',
        onRequest: vi.fn(async () => {
          const err = new Error('blocked by plugin');
          err.statusCode = 403;
          throw err;
        }),
      };

      const g = await createGateway({ plugins: [aborting] });
      try {
        const res = await request(g, '/api/resource', {
          headers: { 'x-api-key': 'key-tenant-a' },
        });
        expect(res.status).toBe(403);
        expect(res.json?.error).toMatch(/blocked by plugin/i);
      } finally {
        await g.close();
      }
    });
  });
});