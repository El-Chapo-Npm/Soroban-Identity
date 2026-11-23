import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { requestContextStore } from '../src/request-context.js';
import { correlationHeaders } from '../src/middleware/tracing.js';
import { getRequestLogFields } from '../src/logger.js';

const testDir = path.join(process.cwd(), 'data', 'test-request-id');
const config = {
  dataDir: testDir,
  auditLogPath: path.join(testDir, 'audit.ndjson'),
  credentialStorePath: path.join(testDir, 'credentials.json'),
  adminApiKey: 'test-api-key',
  adminActor: 'test-admin',
};

const soroban = {
  pingAllContracts: async () => ({ contract1: true }),
  circuitBreaker: {
    toHealthInfo: () => ({ state: 'CLOSED', failures: 0, lastStateChange: '' }),
  },
  getIssuers: async () => [],
  addIssuer: async () => {},
};

const metrics = {
  renderPrometheus: () => 'metrics',
};

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = null;
    this.body = null;
    this.finished = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.headers[key.toLowerCase()] = value;
      }
    }
  }

  end(body) {
    this.body = body;
    this.emit('finish');
    this._resolve();
  }
}

before(async () => {
  await fs.mkdir(testDir, { recursive: true }).catch(() => {});
});

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
});

test('should generate a new request ID if none is provided in headers', async () => {
  const app = createApp({ config, soroban, metrics });
  const req = {
    method: 'GET',
    url: '/health',
    headers: { host: 'localhost' },
  };
  const res = new MockResponse();
  await app(req, res);
  await res.finished;

  const reqId = res.headers['x-request-id'];
  assert.ok(reqId, 'request ID should exist');
  assert.ok(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reqId),
    'request ID should be a valid UUID'
  );
});

test('should echo back the provided X-Request-ID', async () => {
  const app = createApp({ config, soroban, metrics });
  const customId = 'my-custom-request-id-12345';
  const req = {
    method: 'GET',
    url: '/health',
    headers: { host: 'localhost', 'x-request-id': customId },
  };
  const res = new MockResponse();
  await app(req, res);
  await res.finished;

  assert.equal(res.headers['x-request-id'], customId);
});

test('uses one validated correlation ID for both response headers and trace context', async () => {
  const app = createApp({ config, soroban, metrics });
  const correlationId = 'gateway-correlation-123';
  const req = {
    method: 'GET',
    url: '/health',
    headers: { host: 'localhost', 'x-correlation-id': correlationId, 'x-request-id': 'different-request-id' },
  };
  const res = new MockResponse();
  await app(req, res);
  await res.finished;

  assert.equal(res.headers['x-correlation-id'], correlationId);
  assert.equal(res.headers['x-request-id'], correlationId);
  assert.equal(req.correlationId, correlationId);
  assert.equal(req.requestId, correlationId);
});

test('forwards the ambient correlation ID to downstream HTTP services', async () => {
  const headers = await requestContextStore.run(
    { correlationId: 'service-chain-correlation-123' },
    async () => correlationHeaders(),
  );
  assert.deepEqual(headers, { 'x-correlation-id': 'service-chain-correlation-123' });
});

test('adds requestId and correlationId to structured log fields', () => {
  assert.deepEqual(
    getRequestLogFields({ requestId: 'log-test-id-999', correlationId: 'log-test-id-999', traceId: 'trace-123' }),
    { requestId: 'log-test-id-999', correlationId: 'log-test-id-999', traceId: 'trace-123' },
  );
});

test('should include requestId in audit logs generated during request', async () => {
  await fs.rm(config.auditLogPath, { force: true });

  const app = createApp({ config, soroban, metrics });
  const customId = 'audit-test-id-555';
  const req = {
    method: 'POST',
    url: '/admin/issuers',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
      'x-api-key': 'test-api-key',
      'x-request-id': customId,
    },
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({ issuer: 'GDID...' }));
    },
  };
  const res = new MockResponse();
  await app(req, res);
  await res.finished;

  assert.equal(res.statusCode, 201);

  const datedAuditLogPath = `${config.auditLogPath}-${new Date().toISOString().split('T')[0]}.ndjson`;
  const logContent = await fs.readFile(datedAuditLogPath, 'utf8');
  const lines = logContent.trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.requestId, customId);
  assert.equal(entry.correlationId, customId);
  assert.equal(entry.action, 'add_issuer');
});
