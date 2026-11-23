import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../src/app.js';

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = null;
    this.body = null;
    this.finished = new Promise((resolve) => { this.resolve = resolve; });
  }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
  }
  end(body) { this.body = body; this.emit('finish'); this.resolve(); }
}

const metrics = { renderPrometheus: () => 'metrics' };
const soroban = {
  pingAllContracts: async () => ({ credential: true }),
  circuitBreaker: { toHealthInfo: () => ({ state: 'CLOSED', failures: 0, lastStateChange: '' }) },
  getIssuers: async () => [],
  addIssuer: async () => {},
};
const baseConfig = {
  dataDir: '/tmp/soroban-identity-mock-api-test',
  auditLogPath: '/tmp/soroban-identity-mock-api-test/audit.ndjson',
  credentialStorePath: '/tmp/soroban-identity-mock-api-test/credentials.json',
  maxBodyBytes: 4096,
  mockApiEnabled: true,
  nodeEnv: 'development',
};

async function callApp({ path, method = 'GET', body, headers = {}, config = baseConfig }) {
  const app = createApp({ config: { ...baseConfig, ...config }, soroban, metrics });
  const req = {
    method,
    url: path,
    headers: { host: 'localhost', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } }),
  };
  const res = new MockResponse();
  await app(req, res);
  await res.finished;
  return { res, json: JSON.parse(res.body) };
}

test('serves deterministic mock API health, credential, DID, and reputation fixtures', async () => {
  const health = await callApp({ path: '/mock/v1/health' });
  assert.equal(health.res.statusCode, 200);
  assert.deepEqual(health.json, { status: 'ok', mock: true });
  assert.equal(health.res.headers['cache-control'], 'no-store');
  assert.equal(health.res.headers['x-request-id'], health.res.headers['x-correlation-id']);

  const list = await callApp({ path: '/mock/v1/credentials' });
  assert.equal(list.json.count, 1);
  assert.equal(list.json.items[0].id, 'mock-credential-001');

  const did = await callApp({ path: '/mock/v1/dids/GMOCKADDRESS12345678' });
  assert.equal(did.json.document.id, 'did:stellar:GMOCKADDRESS12345678');

  const reputation = await callApp({ path: '/mock/v1/reputation/GMOCKADDRESS12345678' });
  assert.equal(reputation.json.score, 72);
});

test('mock credential creation returns an in-memory fixture without persisting data', async () => {
  await fs.rm(baseConfig.credentialStorePath, { force: true });
  const result = await callApp({
    path: '/mock/v1/credentials',
    method: 'POST',
    body: { subject: 'GMOCKSUBJECT', credentialType: 'Kyc', claims: { name: 'Test' } },
  });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.json.credential.id, 'mock-created-credential');
  assert.equal(result.json.credential.mock, true);
  await assert.rejects(fs.access(baseConfig.credentialStorePath), { code: 'ENOENT' });
});

test('mock routes are hidden unless explicitly enabled and are always disabled in production', async () => {
  const disabled = await callApp({ path: '/mock/v1/health', config: { mockApiEnabled: false } });
  assert.equal(disabled.res.statusCode, 404);
  assert.equal(disabled.json.error, 'not_found');

  const production = await callApp({ path: '/mock/v1/health', config: { nodeEnv: 'production' } });
  assert.equal(production.res.statusCode, 404);
});

test('mockStatus simulates an error response on any mock route', async () => {
  const unavailable = await callApp({ path: '/mock/v1/credentials?mockStatus=503' });
  assert.equal(unavailable.res.statusCode, 503);
  assert.equal(unavailable.json.error, 'service_unavailable');
  assert.equal(unavailable.json.simulated, true);
  assert.equal(unavailable.res.headers['retry-after'], '1');

  const viaHeader = await callApp({ path: '/mock/v1/dids/GMOCK', headers: { 'x-mock-status': '404' } });
  assert.equal(viaHeader.res.statusCode, 404);
  assert.equal(viaHeader.json.simulated, true);
});

test('mock health ignores scenarios so harnesses can always probe it', async () => {
  const health = await callApp({ path: '/mock/v1/health?mockStatus=500' });
  assert.equal(health.res.statusCode, 200);
});

test('mockDelayMs delays the response', async () => {
  const startedAt = Date.now();
  const result = await callApp({ path: '/mock/v1/credentials?mockDelayMs=120' });
  assert.equal(result.res.statusCode, 200);
  assert.ok(Date.now() - startedAt >= 100, 'expected the response to be delayed');
});

test('invalid mock scenarios are rejected with 400', async () => {
  const badStatus = await callApp({ path: '/mock/v1/credentials?mockStatus=418' });
  assert.equal(badStatus.res.statusCode, 400);
  assert.equal(badStatus.json.error, 'invalid_mock_scenario');

  const badDelay = await callApp({ path: '/mock/v1/credentials?mockDelayMs=999999' });
  assert.equal(badDelay.res.statusCode, 400);

  const negativeDelay = await callApp({ path: '/mock/v1/credentials?mockDelayMs=-5' });
  assert.equal(negativeDelay.res.statusCode, 400);
});

test('mock info advertises the supported scenarios', async () => {
  const info = await callApp({ path: '/mock/v1/info' });
  assert.ok(info.json.scenarios.mockStatus.includes(503));
  assert.equal(info.json.scenarios.mockDelayMs.max, 5000);
});
