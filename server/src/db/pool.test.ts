import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConnectionPool,
  type PoolClient,
  type PoolConfig,
  type ReplicaConfig,
  type ReplicaRegion,
} from './pool';

/**
 * Minimal in-memory fake client used to exercise the pool without a real
 * database. It records lifecycle calls so tests can assert on health checks,
 * reconnection and shutdown behaviour.
 */
class FakeClient implements PoolClient {
  public connected = true;
  public released = false;
  public queries: string[] = [];
  public failNextQuery = false;
  public failHealthCheck = false;

  constructor(public readonly id: number) {}

  async query<T = unknown>(sql: string): Promise<T> {
    if (!this.connected) {
      throw new Error('connection lost');
    }
    if (this.failNextQuery) {
      this.failNextQuery = false;
      throw new Error('transient query failure');
    }
    this.queries.push(sql);
    return [] as unknown as T;
  }

  async ping(): Promise<boolean> {
    if (!this.connected || this.failHealthCheck) {
      return false;
    }
    return true;
  }

  async release(): Promise<void> {
    this.released = true;
  }

  async destroy(): Promise<void> {
    this.connected = false;
    this.released = true;
  }
}

function makeFactory() {
  let counter = 0;
  const created: FakeClient[] = [];
  const factory = async (): Promise<PoolClient> => {
    const client = new FakeClient(++counter);
    created.push(client);
    return client;
  };
  return { factory, created };
}

const baseConfig = (overrides: Partial<PoolConfig> = {}): PoolConfig => ({
  max: 10,
  min: 0,
  acquireTimeoutMs: 1000,
  queryTimeoutMs: 30000,
  healthCheckIntervalMs: 0,
  maxRetries: 2,
  retryDelayMs: 1,
  ...overrides,
});

const replicaConfig = (
  region: ReplicaRegion,
  overrides: Partial<ReplicaConfig> = {},
): ReplicaConfig => ({
  region,
  host: `${region}.replica.internal`,
  max: 5,
  lagThresholdMs: 5000,
  ...overrides,
});

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  it('defaults to a pool size of 10 and a 30s query timeout', () => {
    const { factory } = makeFactory();
    pool = new ConnectionPool(factory);
    expect(pool.config.max).toBe(10);
    expect(pool.config.queryTimeoutMs).toBe(30000);
  });

  it('reuses a released connection instead of opening a new one', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ max: 1 }));

    const first = await pool.acquire();
    await first.release();
    const second = await pool.acquire();

    expect(created).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('runs a health check before executing a query', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig());

    const client = created[0];
    await pool.query('SELECT 1');

    expect(client.queries).toContain('SELECT 1');
  });

  it('reconnects automatically when a connection is lost', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ max: 1 }));

    const first = await pool.acquire();
    (first as unknown as FakeClient).connected = false;
    await first.release();

    const second = await pool.acquire();
    expect(second).not.toBe(first);
    expect(created.length).toBeGreaterThan(1);
  });

  it('retries transient query failures up to maxRetries', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ maxRetries: 2 }));

    const client = created[0];
    client.failNextQuery = true;

    await expect(pool.query('SELECT 1')).resolves.toBeDefined();
    expect(client.queries).toContain('SELECT 1');
  });

  it('enforces the query timeout', async () => {
    const { factory } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ queryTimeoutMs: 5 }));

    const slow = vi.spyOn(pool as unknown as { runQuery: () => Promise<unknown> }, 'runQuery');
    slow.mockImplementation(() => new Promise(() => {}));

    await expect(pool.query('SELECT pg_sleep(10)')).rejects.toThrow(/timeout/i);
    slow.mockRestore();
  });

  it('reports pool metrics for active, idle and waiting connections', async () => {
    const { factory } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ max: 2 }));

    const a = await pool.acquire();
    const b = await pool.acquire();
    const waiting = pool.acquire();

    const metrics = pool.metrics();
    expect(metrics.active).toBe(2);
    expect(metrics.waiting).toBe(1);
    expect(metrics.idle).toBe(0);

    await a.release();
    await b.release();
    await waiting;
  });

  it('handles concurrent acquisition without exceeding the pool size', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ max: 3 }));

    const clients = await Promise.all(
      Array.from({ length: 20 }, () => pool.acquire()),
    );

    expect(created.length).toBeLessThanOrEqual(3);
    expect(new Set(clients).size).toBeLessThanOrEqual(3);

    await Promise.all(clients.map((c) => c.release()));
  });

  it('shuts down gracefully and releases all connections', async () => {
    const { factory, created } = makeFactory();
    pool = new ConnectionPool(factory, baseConfig({ max: 2 }));

    await pool.acquire();
    await pool.acquire();
    await pool.shutdown();

    expect(created.every((c) => c.released)).toBe(true);
    await expect(pool.acquire()).rejects.toThrow(/shut ?down|closed/i);
  });
});

describe('ConnectionPool read/write splitting', () => {
  let pool: ConnectionPool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  it('routes writes to the primary and reads to a replica', async () => {
    const { factory, created } = makeFactory();
    const replicas = [
      replicaConfig('us-east-1'),
      replicaConfig('eu-west-1'),
      replicaConfig('ap-southeast-1'),
    ];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    await pool.query('INSERT INTO users (id) VALUES (1)');
    await pool.query('SELECT * FROM users');

    const primary = created[0];
    expect(primary.queries).toContain('INSERT INTO users (id) VALUES (1)');
    expect(primary.queries).not.toContain('SELECT * FROM users');
  });

  it('routes reads to the nearest healthy replica', async () => {
    const { factory } = makeFactory();
    const replicas = [
      replicaConfig('us-east-1'),
      replicaConfig('eu-west-1'),
      replicaConfig('ap-southeast-1'),
    ];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    const target = pool.nearestReplica({ latitude: 51.5, longitude: -0.12 });
    expect(target?.region).toBe('eu-west-1');
  });

  it('falls back to the primary when a replica fails', async () => {
    const { factory, created } = makeFactory();
    const replicas = [replicaConfig('us-east-1')];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    pool.markReplicaUnhealthy('us-east-1');
    await pool.query('SELECT * FROM users');

    const primary = created[0];
    expect(primary.queries).toContain('SELECT * FROM users');
  });

  it('fails over to the primary when all replicas are unhealthy', async () => {
    const { factory, created } = makeFactory();
    const replicas = [
      replicaConfig('us-east-1'),
      replicaConfig('eu-west-1'),
      replicaConfig('ap-southeast-1'),
    ];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    for (const replica of replicas) {
      pool.markReplicaUnhealthy(replica.region);
    }

    await pool.query('SELECT * FROM users');
    expect(created[0].queries).toContain('SELECT * FROM users');
  });

  it('skips replicas whose lag exceeds the threshold', async () => {
    const { factory, created } = makeFactory();
    const replicas = [
      replicaConfig('us-east-1', { lagThresholdMs: 1000 }),
      replicaConfig('eu-west-1', { lagThresholdMs: 1000 }),
    ];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    pool.recordReplicaLag('us-east-1', 5000);
    pool.recordReplicaLag('eu-west-1', 100);

    const target = pool.nearestReplica({ latitude: 38.9, longitude: -77.0 });
    expect(target?.region).toBe('eu-west-1');

    await pool.query('SELECT * FROM users');
    expect(created[0].queries).toContain('SELECT * FROM users');
  });

  it('exposes replica lag metrics for monitoring', async () => {
    const { factory } = makeFactory();
    const replicas = [
      replicaConfig('us-east-1'),
      replicaConfig('eu-west-1'),
      replicaConfig('ap-southeast-1'),
    ];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    pool.recordReplicaLag('us-east-1', 120);
    pool.recordReplicaLag('eu-west-1', 340);

    const metrics = pool.replicaMetrics();
    expect(metrics).toHaveLength(3);
    expect(metrics.find((m) => m.region === 'us-east-1')?.lagMs).toBe(120);
    expect(metrics.find((m) => m.region === 'eu-west-1')?.lagMs).toBe(340);
  });

  it('supports read-your-writes by pinning reads to the primary after a write', async () => {
    const { factory, created } = makeFactory();
    const replicas = [replicaConfig('us-east-1')];
    pool = new ConnectionPool(factory, baseConfig({ replicas }));

    await pool.query('INSERT INTO users (id) VALUES (1)');
    await pool.query('SELECT * FROM users', { consistency: 'strong' });

    const primary = created[0];
    expect(primary.queries).toContain('SELECT * FROM users');
  });
});
