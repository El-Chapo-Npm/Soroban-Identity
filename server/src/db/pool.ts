import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Connection pool management with health checks, automatic reconnection,
 * query timeout handling and pool metrics.
 *
 * See issue #809 [BE-NEW-10].
 */

export interface PoolMetrics {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}

/** Minimal surface of a pg Pool used by DatabasePool (allows fakes in tests). */
export interface PoolLike {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

/** Factory used to construct the underlying pool (injectable for tests). */
export type PoolFactory = (poolConfig: PoolConfig) => PoolLike;

export interface PoolOptions {
  /** Maximum number of clients the pool will hold. Defaults to 10. */
  max?: number;
  /** Minimum number of idle clients kept alive. Defaults to 0. */
  min?: number;
  /** Milliseconds a client may sit idle before being released. */
  idleTimeoutMillis?: number;
  /** Milliseconds to wait for a connection before failing. */
  connectionTimeoutMillis?: number;
  /** Default per-query timeout in milliseconds. Defaults to 30_000. */
  queryTimeoutMillis?: number;
  /** Number of reconnect attempts before giving up. */
  maxRetries?: number;
  /** Base delay (ms) between reconnect attempts (exponential backoff). */
  retryDelayMillis?: number;
  /** Override the connection string (defaults to config.database.url). */
  connectionString?: string;
  /** Inject a custom pool factory (defaults to constructing a pg Pool). */
  poolFactory?: PoolFactory;
}

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

/** Errors that indicate a transient/lost connection worth retrying. */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
]);

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DatabasePool {
  private pool: PoolLike | null = null;
  private readonly poolConfig: PoolConfig;
  private readonly poolFactory: PoolFactory;
  private readonly queryTimeoutMillis: number;
  private readonly maxRetries: number;
  private readonly retryDelayMillis: number;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: PoolOptions = {}) {
    this.poolConfig = {
      connectionString: options.connectionString ?? config.database.url,
      max: options.max ?? DEFAULT_POOL_SIZE,
      min: options.min ?? 0,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
      // Keep TCP connections alive so transient drops are detected early.
      keepAlive: true,
    };

    this.queryTimeoutMillis = options.queryTimeoutMillis ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMillis = options.retryDelayMillis ?? DEFAULT_RETRY_DELAY_MS;
    this.poolFactory = options.poolFactory ?? ((cfg: PoolConfig) => new Pool(cfg));

    // Construct eagerly unless a factory was injected; tests may inject a
    // fake driver and control construction timing themselves.
    if (!options.poolFactory) {
      this.getPool();
    }
  }

  /** Lazily construct (or return) the underlying pool. */
  getPool(): PoolLike {
    if (!this.pool) {
      const pool = this.poolFactory(this.poolConfig);
      pool.on('connect', () => {
        logger.debug('db.pool: client connected');
      });
      pool.on('acquire', () => {
        logger.debug('db.pool: client acquired');
      });
      pool.on('remove', () => {
        logger.debug('db.pool: client removed');
      });
      pool.on('error', (err) => {
        // Idle client errors must not crash the process.
        logger.error('db.pool: idle client error', {
          error: (err as Error)?.message,
        });
      });
      this.pool = pool;
    }
    return this.pool;
  }

  /** Whether the pool has begun (or completed) shutting down. */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Current pool metrics: active, idle and waiting connections. */
  metrics(): PoolMetrics {
    if (!this.pool) {
      return { total: 0, active: 0, idle: 0, waiting: 0 };
    }
    const total = this.pool.totalCount;
    const idle = this.pool.idleCount;
    return {
      total,
      active: total - idle,
      idle,
      waiting: this.pool.waitingCount,
    };
  }

  /** Verify a client is usable before handing it to a query. */
  private async healthCheck(client: PoolClient): Promise<void> {
    await client.query('SELECT 1');
  }

  /**
   * Acquire a healthy client, retrying with exponential backoff on
   * transient connection failures.
   */
  private async acquireHealthyClient(): Promise<PoolClient> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.shuttingDown) {
        throw new Error('db.pool: pool is shutting down');
      }
      try {
        const client = await this.getPool().connect();
        try {
          await this.healthCheck(client);
          return client;
        } catch (err) {
          // Unhealthy client: discard and retry.
          client.release(true);
          throw err;
        }
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries || !isRetryable(err)) {
          break;
        }
        const delay = this.retryDelayMillis * 2 ** attempt;
        logger.warn('db.pool: connection attempt failed, retrying', {
          attempt: attempt + 1,
          delay,
          error: (err as Error).message,
        });
        await sleep(delay);
      }
    }
    logger.error('db.pool: unable to acquire connection', {
      error: (lastError as Error)?.message,
    });
    throw lastError;
  }

  /**
   * Execute a query with a per-query timeout and automatic retry on
   * transient connection loss.
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
    timeoutMillis: number = this.queryTimeoutMillis,
  ): Promise<QueryResult<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const client = await this.acquireHealthyClient();
      try {
        return await this.withTimeout(client.query<T>(text, params), timeoutMillis);
      } catch (err) {
        lastError = err;
        // Release the client; mark it broken if the connection was lost.
        client.release(isRetryable(err));
        if (attempt === this.maxRetries || !isRetryable(err)) {
          break;
        }
        const delay = this.retryDelayMillis * 2 ** attempt;
        logger.warn('db.pool: query failed, retrying', {
          attempt: attempt + 1,
          delay,
          error: (err as Error).message,
        });
        await sleep(delay);
      }
    }
    throw lastError;
  }

  /** Run a callback inside a transaction with timeout + retry. */
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    timeoutMillis: number = this.queryTimeoutMillis,
  ): Promise<T> {
    const client = await this.acquireHealthyClient();
    let caughtError: unknown;
    try {
      await this.withTimeout(client.query('BEGIN'), timeoutMillis);
      const result = await this.withTimeout(fn(client), timeoutMillis);
      await this.withTimeout(client.query('COMMIT'), timeoutMillis);
      return result;
    } catch (err) {
      caughtError = err;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('db.pool: rollback failed', {
          error: (rollbackErr as Error).message,
        });
      }
      throw err;
    } finally {
      // Discard the client if the connection was lost mid-transaction.
      client.release(isRetryable(caughtError));
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMillis: number): Promise<T> {
    if (!timeoutMillis || timeoutMillis <= 0) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`db.pool: query timed out after ${timeoutMillis}ms`);
        (err as { code?: string }).code = 'ETIMEDOUT';
        reject(err);
      }, timeoutMillis);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Gracefully drain and close the pool on server shutdown (idempotent). */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.shutdownPromise = (async () => {
      logger.info('db.pool: shutting down', this.metrics());
      if (this.pool) {
        await this.pool.end();
      }
      logger.info('db.pool: shutdown complete');
    })();
    return this.shutdownPromise;
  }
}

export const dbPool = new DatabasePool();
