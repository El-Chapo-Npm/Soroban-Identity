import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MetricsService } from '../src/metrics.js';
import { ConnectionPool } from '../src/connection-pool.js';

function newMetrics() {
  return new MetricsService({ collectDefaultMetrics: false });
}

// -- #1358: Prometheus DB pool stats ------------------------------------

test('updateDbPoolStats exposes pg.Pool counters as gauges', async () => {
  const metrics = newMetrics();
  metrics.updateDbPoolStats({ totalCount: 8, idleCount: 3, waitingCount: 2 });
  const out = await metrics.renderPrometheus();
  assert.match(out, /db_pool_connections\{state="total"\} 8/);
  assert.match(out, /db_pool_connections\{state="idle"\} 3/);
  assert.match(out, /db_pool_connections\{state="active"\} 5/);
  assert.match(out, /db_pool_waiting_requests 2/);
});

test('updateDbPoolStats accepts ConnectionPool.getStats() shape and ignores null', async () => {
  const metrics = newMetrics();
  metrics.updateDbPoolStats(null);
  metrics.updateDbPoolStats({
    getStats: () => ({ totalConnections: 4, idleConnections: 1, waitingRequests: 0 }),
  });
  const out = await metrics.renderPrometheus();
  assert.match(out, /db_pool_connections\{state="active"\} 3/);
});

test('updateDbPoolStats ignores unrecognised objects', async () => {
  const metrics = newMetrics();
  metrics.updateDbPoolStats({ foo: 1 });
  const out = await metrics.renderPrometheus();
  assert.doesNotMatch(out, /db_pool_connections\{/);
});

// -- #1363: connections are always released -----------------------------

function makePool(maxPoolSize = 2) {
  let n = 0;
  const closed = [];
  const pool = new ConnectionPool({
    name: 'test',
    maxPoolSize,
    minPoolSize: 0,
    connectionFactory: async () => {
      const id = ++n;
      return { close: async () => { closed.push(id); } };
    },
  });
  return { pool, closed };
}

test('withConnection releases the connection when the callback throws', async () => {
  const { pool } = makePool(2);
  await assert.rejects(
    pool.withConnection(async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(pool.getStats().activeConnections, 0);
  assert.equal(pool.getStats().idleConnections, 1);
  await pool.close();
});

test('pool survives many more failing requests than max pool size', async () => {
  const { pool } = makePool(2);
  for (let i = 0; i < 250; i++) {
    await assert.rejects(
      pool.withConnection(async () => { throw new Error('query failed'); }),
      /query failed/,
    );
  }
  assert.equal(pool.getStats().activeConnections, 0);
  // Still able to serve a request: nothing leaked.
  assert.equal(await pool.withConnection(async () => 'ok'), 'ok');
  await pool.close();
});

test('withConnection returns the callback result', async () => {
  const { pool } = makePool(1);
  assert.equal(await pool.withConnection(async (c) => typeof c.id), 'string');
  await pool.close();
});

test('unhealthy connections are closed rather than leaked on release', async () => {
  const { pool, closed } = makePool(2);
  const conn = await pool.acquire();
  conn.healthy = false;
  await pool.release(conn);
  assert.equal(closed.length, 1);
  assert.equal(pool.getStats().totalConnections, 0);
  await pool.close();
});
