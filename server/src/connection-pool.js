import { logger } from './logger.js';

/**
 * Database connection pool for managing and optimizing database connections.
 * Implements connection health checks, monitoring, and leak detection.
 */
export class ConnectionPool {
  constructor(options = {}) {
    this.name = options.name ?? 'database';
    this.minPoolSize = options.minPoolSize ?? 2;
    this.maxPoolSize = options.maxPoolSize ?? 10;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 5000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30000;
    this.maxConnectionAgeMs = options.maxConnectionAgeMs ?? 3600000; // 1 hour
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30000;
    this.connectionRecycleThreshold = options.connectionRecycleThreshold ?? 0.75; // 75% of maxAge
    this.leakDetectionThresholdMs = options.leakDetectionThresholdMs ?? 300000; // 5 minutes
    
    this.connections = new Map(); // Map of connection id -> connection info
    this.available = []; // Available connections
    this.inUse = new Set(); // In-use connections
    this.metrics = options.metrics ?? null;
    this.connectionFactory = options.connectionFactory ?? null;
    
    this.poolStats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      totalRequests: 0,
      totalReleases: 0,
      totalErrors: 0,
      leakDetectedCount: 0,
    };
    
    this.healthCheckTimer = null;
    this.leakDetectionTimer = null;
    this.closed = false;
  }

  /**
   * Initialize the pool by creating minimum connections.
   */
  async initialize() {
    if (!this.connectionFactory) {
      throw new Error('Connection factory must be provided');
    }

    logger.info({ pool: this.name, minPoolSize: this.minPoolSize }, 'Initializing connection pool');

    for (let i = 0; i < this.minPoolSize; i++) {
      try {
        const conn = await this._createConnection();
        this.available.push(conn);
        this.connections.set(conn.id, conn);
      } catch (error) {
        logger.error({ pool: this.name, error: error.message }, 'Failed to initialize pool connection');
      }
    }

    this.poolStats.totalConnections = this.available.length;
    this.startHealthCheckTimer();
    this.startLeakDetectionTimer();

    logger.info({ pool: this.name, available: this.available.length }, 'Connection pool initialized');
  }

  /**
   * Acquire a connection from the pool.
   */
  async acquire() {
    if (this.closed) {
      throw new Error(`Connection pool '${this.name}' is closed`);
    }

    this.poolStats.totalRequests++;

    // Try to get an available connection
    while (this.available.length > 0) {
      const conn = this.available.pop();
      
      // Check if connection is still healthy
      if (await this._isConnectionHealthy(conn)) {
        this.inUse.add(conn.id);
        this.poolStats.activeConnections = this.inUse.size;
        return conn;
      } else {
        // Remove unhealthy connection
        this.connections.delete(conn.id);
        this.poolStats.totalConnections--;
      }
    }

    // If we haven't reached max connections, create a new one
    if (this.poolStats.totalConnections < this.maxPoolSize) {
      try {
        const conn = await this._createConnection();
        this.connections.set(conn.id, conn);
        this.poolStats.totalConnections++;
        this.inUse.add(conn.id);
        this.poolStats.activeConnections = this.inUse.size;
        return conn;
      } catch (error) {
        this.poolStats.totalErrors++;
        throw new Error(`Failed to acquire connection: ${error.message}`);
      }
    }

    throw new Error(`Connection pool '${this.name}' exhausted (max: ${this.maxPoolSize})`);
  }

  /**
   * Release a connection back to the pool.
   */
  async release(conn) {
    if (!conn || !this.connections.has(conn.id)) {
      return;
    }

    this.poolStats.totalReleases++;
    this.inUse.delete(conn.id);

    // Check if connection needs recycling due to age
    const age = Date.now() - conn.createdAt;
    if (age > this.maxConnectionAgeMs * this.connectionRecycleThreshold) {
      try {
        await conn.close?.();
      } catch (error) {
        logger.warn({ pool: this.name, error: error.message }, 'Error closing aged connection');
      }
      this.connections.delete(conn.id);
      this.poolStats.totalConnections--;
      return;
    }

    // Return to available pool if healthy
    if (await this._isConnectionHealthy(conn)) {
      this.available.push(conn);
    } else {
      this.connections.delete(conn.id);
      this.poolStats.totalConnections--;
    }

    this.poolStats.activeConnections = this.inUse.size;
    this.poolStats.idleConnections = this.available.length;
  }

  /**
   * Create a new connection.
   */
  async _createConnection() {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const conn = await this.connectionFactory(id);
    return {
      id,
      ...conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      healthy: true,
    };
  }

  /**
   * Check if a connection is still healthy.
   */
  async _isConnectionHealthy(conn) {
    if (!conn.healthy) return false;

    // Check connection age
    const age = Date.now() - conn.createdAt;
    if (age > this.maxConnectionAgeMs) {
      return false;
    }

    // Check for idle timeout
    const idleTime = Date.now() - conn.lastUsedAt;
    if (idleTime > this.idleTimeoutMs) {
      return false;
    }

    // Perform health check if available
    if (conn.healthCheck) {
      try {
        await conn.healthCheck();
        return true;
      } catch (error) {
        logger.warn({ pool: this.name, connId: conn.id, error: error.message }, 'Connection health check failed');
        return false;
      }
    }

    return true;
  }

  /**
   * Start periodic health checks.
   */
  startHealthCheckTimer() {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      if (this.closed) return;

      const toRemove = [];
      for (const conn of this.available) {
        if (!(await this._isConnectionHealthy(conn))) {
          toRemove.push(conn);
        }
      }

      for (const conn of toRemove) {
        const index = this.available.indexOf(conn);
        if (index > -1) {
          this.available.splice(index, 1);
        }
        this.connections.delete(conn.id);
        this.poolStats.totalConnections--;
        
        try {
          await conn.close?.();
        } catch (error) {
          logger.warn({ pool: this.name, error: error.message }, 'Error closing unhealthy connection');
        }
      }

      if (toRemove.length > 0) {
        logger.info({ pool: this.name, removed: toRemove.length }, 'Removed unhealthy connections');
        if (this.metrics?.observeConnectionPoolHealth) {
          this.metrics.observeConnectionPoolHealth({ pool: this.name, stats: this.poolStats });
        }
      }
    }, this.healthCheckIntervalMs);

    this.healthCheckTimer.unref();
  }

  /**
   * Start leak detection timer.
   */
  startLeakDetectionTimer() {
    if (this.leakDetectionTimer) return;

    this.leakDetectionTimer = setInterval(() => {
      if (this.closed) return;

      const now = Date.now();
      let leaksDetected = 0;

      for (const connId of this.inUse) {
        const conn = this.connections.get(connId);
        if (conn) {
          const holdTime = now - conn.lastUsedAt;
          if (holdTime > this.leakDetectionThresholdMs) {
            logger.warn({
              pool: this.name,
              connId,
              holdTimeMs: holdTime,
              threshold: this.leakDetectionThresholdMs,
            }, 'Potential connection leak detected');
            leaksDetected++;
          }
        }
      }

      if (leaksDetected > 0) {
        this.poolStats.leakDetectedCount += leaksDetected;
        if (this.metrics?.observeConnectionLeak) {
          this.metrics.observeConnectionLeak({ pool: this.name, count: leaksDetected });
        }
      }
    }, this.leakDetectionThresholdMs / 2);

    this.leakDetectionTimer.unref();
  }

  /**
   * Get pool statistics.
   */
  getStats() {
    return {
      ...this.poolStats,
      totalConnections: this.connections.size,
      activeConnections: this.inUse.size,
      idleConnections: this.available.length,
    };
  }

  /**
   * Drain the pool and close all connections.
   */
  async drain() {
    logger.info({ pool: this.name }, 'Draining connection pool');

    clearInterval(this.healthCheckTimer);
    clearInterval(this.leakDetectionTimer);

    const drainPromises = [];
    for (const conn of this.connections.values()) {
      drainPromises.push(
        conn.close?.().catch((error) => {
          logger.warn({ pool: this.name, connId: conn.id, error: error.message }, 'Error draining connection');
        })
      );
    }

    await Promise.all(drainPromises);
    this.connections.clear();
    this.available = [];
    this.inUse.clear();
    this.poolStats.totalConnections = 0;
    this.poolStats.activeConnections = 0;
    this.poolStats.idleConnections = 0;

    logger.info({ pool: this.name }, 'Connection pool drained');
  }

  /**
   * Close the pool.
   */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.drain();
  }
}

/**
 * Create a connection pool with factory function.
 */
export function createConnectionPool(name, connectionFactory, options = {}) {
  return new ConnectionPool({
    name,
    connectionFactory,
    ...options,
  });
}
