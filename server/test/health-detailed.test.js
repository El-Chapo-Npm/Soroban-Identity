import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  STATUS,
  aggregateStatus,
  checkContracts,
  checkDatabase,
  checkRedis,
  checkRpc,
  checkStorage,
  collectHealth,
  collectReadiness,
  uptimeSeconds,
} from '../src/health.js';

async function makeConfig(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'health-'));
  return {
    dataDir,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    redisUrl: '',
    healthProbeTimeoutMs: 200,
    contracts: { identity: 'CID', credential: 'CCRED', reputation: 'CREP' },
    ...overrides,
  };
}

function okRpc(result = { status: 'healthy', latestLedger: 1234 }) {
  return async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
}

function sorobanStub(contracts) {
  return { pingAllContracts: async () => contracts };
}

test('checkStorage reports up when the data directory is writable', async () => {
  const config = await makeConfig();
  const result = await checkStorage(config);

  assert.equal(result.status, STATUS.UP);
  assert.equal(result.writable, true);
  assert.equal(result.dataDir, config.dataDir);

  // The probe must clean up after itself.
  const entries = await fs.readdir(config.dataDir);
  assert.deepEqual(entries, []);
});

test('checkStorage throws when the data directory cannot be written', async () => {
  const config = await makeConfig();
  const fsImpl = {
    mkdir: async () => {},
    writeFile: async () => {
      throw new Error('EACCES: permission denied');
    },
    unlink: async () => {},
  };

  await assert.rejects(() => checkStorage(config, { fsImpl }), /permission denied/);
});

test('checkRpc reports up for a healthy node and surfaces the ledger', async () => {
  const config = await makeConfig();
  const result = await checkRpc(config, { fetchImpl: okRpc() });

  assert.equal(result.status, STATUS.UP);
  assert.equal(result.rpcStatus, 'healthy');
  assert.equal(result.latestLedger, 1234);
  assert.equal(result.url, config.rpcUrl);
});

test('checkRpc reports degraded when the node reports a non-healthy status', async () => {
  const config = await makeConfig();
  const result = await checkRpc(config, { fetchImpl: okRpc({ status: 'syncing' }) });

  assert.equal(result.status, STATUS.DEGRADED);
  assert.equal(result.rpcStatus, 'syncing');
});

test('checkRpc throws on an HTTP error and on a JSON-RPC error', async () => {
  const config = await makeConfig();

  await assert.rejects(
    () => checkRpc(config, { fetchImpl: async () => ({ ok: false, status: 502 }) }),
    /HTTP 502/,
  );

  await assert.rejects(
    () =>
      checkRpc(config, {
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: { message: 'boom' } }) }),
      }),
    /boom/,
  );
});

test('checkContracts distinguishes up, degraded, and down', async () => {
  const allUp = await checkContracts(sorobanStub({ identity: true, credential: true, reputation: true }));
  assert.equal(allUp.status, STATUS.UP);
  assert.equal(allUp.reachable, 3);

  const partial = await checkContracts(sorobanStub({ identity: true, credential: false, reputation: true }));
  assert.equal(partial.status, STATUS.DEGRADED);
  assert.equal(partial.reachable, 2);

  const none = await checkContracts(sorobanStub({ identity: false, credential: false, reputation: false }));
  assert.equal(none.status, STATUS.DOWN);
  assert.equal(none.reachable, 0);
});

test('checkRedis reports disabled when no Redis is configured', async () => {
  const config = await makeConfig();
  const result = await checkRedis(config, null);

  assert.equal(result.status, STATUS.DISABLED);
  assert.match(result.reason, /REDIS_URL/);
});

test('checkRedis pings a configured client', async () => {
  const config = await makeConfig({ redisUrl: 'redis://localhost:6379' });
  const result = await checkRedis(config, { ping: async () => 'PONG' });

  assert.equal(result.status, STATUS.UP);
  assert.equal(result.response, 'PONG');
});

test('checkDatabase reports disabled when no database is configured', async () => {
  const config = await makeConfig();
  const result = await checkDatabase(config, null);

  assert.equal(result.status, STATUS.DISABLED);
  assert.match(result.reason, /DATABASE_URL/);
});

test('checkDatabase runs SELECT 1 on a configured client', async () => {
  const config = await makeConfig({ databaseUrl: 'postgres://localhost/soroban' });
  const queries = [];
  const result = await checkDatabase(config, {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ '?column?': 1 }] };
    },
  });

  assert.equal(result.status, STATUS.UP);
  assert.deepEqual(queries, ['SELECT 1']);
});

test('aggregateStatus ignores disabled dependencies', () => {
  assert.equal(
    aggregateStatus([{ status: STATUS.UP }, { status: STATUS.DISABLED }]),
    'healthy',
  );
  assert.equal(
    aggregateStatus([{ status: STATUS.UP }, { status: STATUS.DEGRADED }]),
    'degraded',
  );
  assert.equal(
    aggregateStatus([{ status: STATUS.DEGRADED }, { status: STATUS.DOWN }]),
    'unhealthy',
  );
  // A deployment with every optional dependency switched off is still healthy.
  assert.equal(aggregateStatus([{ status: STATUS.DISABLED }]), 'healthy');
});

test('uptimeSeconds grows with wall-clock time', () => {
  const now = Date.now();
  assert.ok(uptimeSeconds(now) >= 0);
  assert.ok(uptimeSeconds(now + 5000) >= uptimeSeconds(now) + 4);
});

test('collectHealth reports every dependency with version and uptime', async () => {
  const config = await makeConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okRpc();

  try {
    const health = await collectHealth({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      version: '9.9.9',
    });

    assert.equal(health.status, 'healthy');
    assert.equal(health.version, '9.9.9');
    assert.ok(Number.isInteger(health.uptimeSeconds));
    assert.ok(health.startedAt);
    assert.equal(health.nodeVersion, process.version);

    assert.deepEqual(Object.keys(health.dependencies).sort(), [
      'contracts',
      'database',
      'eventStore',
      'readReplicas',
      'redis',
      'rpc',
      'storage',
    ]);
    assert.equal(health.dependencies.database.status, STATUS.DISABLED);
    assert.equal(health.dependencies.redis.status, STATUS.DISABLED);
    for (const dependency of Object.values(health.dependencies)) {
      assert.ok(Number.isInteger(dependency.latencyMs));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectHealth degrades rather than failing when one contract is unreachable', async () => {
  const config = await makeConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okRpc();

  try {
    const health = await collectHealth({
      config,
      soroban: sorobanStub({ identity: true, credential: false, reputation: true }),
      version: '1.0.0',
    });

    assert.equal(health.status, 'degraded');
    assert.equal(health.dependencies.contracts.status, STATUS.DEGRADED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectHealth marks the service unhealthy when RPC is down', async () => {
  const config = await makeConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };

  try {
    const health = await collectHealth({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      version: '1.0.0',
    });

    assert.equal(health.status, 'unhealthy');
    assert.equal(health.dependencies.rpc.status, STATUS.DOWN);
    assert.match(health.dependencies.rpc.error, /ECONNREFUSED/);
    // A failing probe must not prevent the others from being reported.
    assert.equal(health.dependencies.storage.status, STATUS.UP);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a hung dependency times out instead of stalling the whole report', async () => {
  const config = await makeConfig({ healthProbeTimeoutMs: 50 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const keepAlive = setInterval(() => {}, 10);

  try {
    const started = Date.now();
    const health = await collectHealth({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      version: '1.0.0',
    });

    assert.equal(health.dependencies.rpc.status, STATUS.DOWN);
    assert.match(health.dependencies.rpc.error, /timed out/);
    assert.ok(Date.now() - started < 2000);
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
  }
});

test('collectHealth marks the service unhealthy when the database is down', async () => {
  const config = await makeConfig({ databaseUrl: 'postgres://localhost/soroban' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okRpc();

  try {
    const health = await collectHealth({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      dbClient: { query: async () => { throw new Error('ECONNREFUSED'); } },
      version: '1.0.0',
    });

    assert.equal(health.status, 'unhealthy');
    assert.equal(health.dependencies.database.status, STATUS.DOWN);
    assert.match(health.dependencies.database.error, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectReadiness gates on storage, RPC and a configured database', async () => {
  const config = await makeConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okRpc();

  try {
    // Every contract unreachable — still ready, because most endpoints work.
    const readiness = await collectReadiness({
      config,
      soroban: sorobanStub({ identity: false, credential: false, reputation: false }),
      version: '1.0.0',
    });

    assert.equal(readiness.ready, true);
    assert.deepEqual(Object.keys(readiness.checks).sort(), [
      'database',
      'eventStore',
      'readReplicas',
      'rpc',
      'storage',
    ]);
    assert.equal(readiness.checks.database.status, STATUS.DISABLED);
    assert.equal(readiness.failing, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectReadiness reports not ready and names the failing dependency', async () => {
  const config = await makeConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    const readiness = await collectReadiness({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      version: '1.0.0',
    });

    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.failing, ['rpc']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectReadiness reports not ready when a configured database is down', async () => {
  const config = await makeConfig({ databaseUrl: 'postgres://localhost/soroban' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okRpc();

  try {
    const readiness = await collectReadiness({
      config,
      soroban: sorobanStub({ identity: true, credential: true, reputation: true }),
      dbClient: { query: async () => { throw new Error('database unavailable'); } },
      version: '1.0.0',
    });

    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.failing, ['database']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
