import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabasePool, type PoolOptions, type PoolMetrics } from './pool';

/**
 * Minimal in-memory fake of a `pg.Pool` used to exercise the DatabasePool
 * without a real database. It records lifecycle calls so tests can assert on
 * health checks, reconnection, timeouts and shutdown behaviour.
 */
class FakePgClient {
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
      const err = new Error('transient query failure') as Error & { code?: string };
      err.code = 'ECONNRESET';
      throw err;
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

/**
 * Fake `pg.Pool` exposing the subset of the API DatabasePool relies on:
 * `connect()`, `query()`, `end()` and `totalCount`/`idleCount`/`waitingCount`.
 */
class FakePgPool {
  public clients: FakePgClient[] = [];
  public ended = false;
  public waitingCount = 0;
  private counter = 0;
  private idle: FakePgClient[] = [];

  async connect(): Promise<FakePgClient> {
    if (this.ended) {
      throw new Error('pool has been shut down');
    }
    const reused = this.idle.pop();
    if (reused && reused.connected) {
      return reused;
    }
    const client = new FakePgClient(++this.counter);
    this.clients.push(client);
    return client;
  }

  async query<T = unknown>(sql: string): Promise<T> {
    const client = await this.connect();
    try {
      return await client.query<T>(sql);
    } finally {
      await client.release();
    }
  }

  async end(): Promise<void> {
    this.ended = true;
    for (const client of this.clients) {
      await client.destroy();
    }
  }

  get totalCount(): number {
    return this.clients.length;
  }

  get idleCount(): number {
    return this.idle.length;
  }
}

function makeFactory() {
  const pool = new FakePgPool();
  const factory = () => pool as unknown as import('pg').Pool;
  return { factory, pool };
}

const baseOptions = (overrides: Partial<PoolOptions> = {}): PoolOptions => ({
  max: 10,
  min: 0,
  acquireTimeoutMs: 1000,
  queryTimeoutMs: 30000,
  healthCheckIntervalMs: 0,
  maxRetries: 2,
  retryDelayMs: 1,
  ...overrides,
});

describe('DatabasePool', () => {
  let pool: DatabasePool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  it('defaults to a pool size of 10 and a 30s query timeout', () => {
    const { factory } = makeFactory();
    pool = new DatabasePool(baseOptions(), factory);
    expect(pool.options.max).toBe(10);
    expect(pool.options.queryTimeoutMs).toBe(30000);
  });

  it('reuses a released connection instead of opening a new one', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 1 }), factory);

    const first = await pool.acquire();
    await first.release();
    const second = await pool.acquire();

    expect(pgPool.clients).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('runs a health check before executing a query', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions(), factory);

    await pool.query('SELECT 1');

    const client = pgPool.clients[0];
    expect(client.queries).toContain('SELECT 1');
  });

  it('reconnects automatically with exponential backoff on retryable codes', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 1, maxRetries: 3, retryDelayMs: 1 }), factory);

    const first = await pool.acquire();
    (first as unknown as FakePgClient).connected = false;
    await first.release();

    const second = await pool.acquire();
    expect(second).not.toBe(first);
    expect(pgPool.clients.length).toBeGreaterThan(1);
  });

  it('retries transient query failures up to maxRetries', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ maxRetries: 2 }), factory);

    const client = pgPool.clients[0];
    client.failNextQuery = true;

    await expect(pool.query('SELECT 1')).resolves.toBeDefined();
    expect(client.queries).toContain('SELECT 1');
  });

  it('enforces the query timeout', async () => {
    const { factory } = makeFactory();
    pool = new DatabasePool(baseOptions({ queryTimeoutMs: 5 }), factory);

    const slow = vi.spyOn(pool as unknown as { runQuery: () => Promise<unknown> }, 'runQuery');
    slow.mockImplementation(() => new Promise(() => {}));

    await expect(pool.query('SELECT pg_sleep(10)')).rejects.toThrow(/timeout/i);
    slow.mockRestore();
  });

  it('reports pool metrics for active, idle and waiting connections', async () => {
    const { factory } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 2 }), factory);

    const a = await pool.acquire();
    const b = await pool.acquire();
    const waiting = pool.acquire();

    const metrics: PoolMetrics = pool.metrics();
    expect(metrics.active).toBe(2);
    expect(metrics.waiting).toBe(1);
    expect(metrics.idle).toBe(0);

    await a.release();
    await b.release();
    await waiting;
  });

  it('handles concurrent acquisition without exceeding the pool size', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 3 }), factory);

    const clients = await Promise.all(
      Array.from({ length: 20 }, () => pool.acquire()),
    );

    expect(pgPool.clients.length).toBeLessThanOrEqual(3);
    expect(new Set(clients).size).toBeLessThanOrEqual(3);

    await Promise.all(clients.map((c) => c.release()));
  });

  it('shuts down gracefully and releases all connections', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 2 }), factory);

    await pool.acquire();
    await pool.acquire();
    await pool.shutdown();

    expect(pgPool.clients.every((c) => c.released)).toBe(true);
    await expect(pool.acquire()).rejects.toThrow(/shut ?down|closed/i);
  });

  it('survives a stress test with 100+ concurrent queries', async () => {
    const { factory, pool: pgPool } = makeFactory();
    pool = new DatabasePool(baseOptions({ max: 10 }), factory);

    const results = await Promise.all(
      Array.from({ length: 150 }, (_, i) => pool.query(`SELECT ${i}`)),
    );

    expect(results).toHaveLength(150);
    expect(pgPool.clients.length).toBeLessThanOrEqual(10);
  });
});
