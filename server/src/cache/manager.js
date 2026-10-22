'use strict';

/**
 * Unified cache manager.
 *
 * Composes three cache layers:
 *   - L1: in-memory LRU cache (fast, per-process)
 *   - L2: Redis cache (shared, via redis-client)
 *   - L3: CDN (surrogate-control headers + purge)
 *
 * Provides:
 *   - TTL policy registry keyed by data type
 *   - cache-aside reads with single-flight stampede prevention
 *   - write-through for critical data
 *   - write-behind queue for analytics
 *   - hit/miss counters
 */

const { EventEmitter } = require('events');

const DEFAULT_TTL_MS = 60 * 1000;

/**
 * TTL policy registry keyed by data type.
 * Each policy describes TTLs per layer and write strategy.
 */
const TTL_POLICIES = Object.freeze({
  did: {
    l1TtlMs: 30 * 1000,
    l2TtlMs: 5 * 60 * 1000,
    l3TtlMs: 60 * 60 * 1000,
    strategy: 'write-through',
    critical: true,
  },
  credential: {
    l1TtlMs: 60 * 1000,
    l2TtlMs: 10 * 60 * 1000,
    l3TtlMs: 60 * 60 * 1000,
    strategy: 'write-through',
    critical: true,
  },
  verification: {
    l1TtlMs: 15 * 1000,
    l2TtlMs: 2 * 60 * 1000,
    l3TtlMs: 5 * 60 * 1000,
    strategy: 'write-through',
    critical: true,
  },
  apiResponse: {
    l1TtlMs: 10 * 1000,
    l2TtlMs: 60 * 1000,
    l3TtlMs: 5 * 60 * 1000,
    strategy: 'cache-aside',
    critical: false,
  },
  session: {
    l1TtlMs: 5 * 60 * 1000,
    l2TtlMs: 30 * 60 * 1000,
    l3TtlMs: 0, // sessions must never be CDN-cached
    strategy: 'write-through',
    critical: true,
  },
  analytics: {
    l1TtlMs: 0, // analytics bypass L1
    l2TtlMs: 60 * 60 * 1000,
    l3TtlMs: 0,
    strategy: 'write-behind',
    critical: false,
  },
  default: {
    l1TtlMs: DEFAULT_TTL_MS,
    l2TtlMs: 5 * DEFAULT_TTL_MS,
    l3TtlMs: 0,
    strategy: 'cache-aside',
    critical: false,
  },
});

/**
 * Simple LRU cache backed by Map (insertion order = recency order).
 */
class LruCache {
  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const entry = this.map.get(key);
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (ttlMs <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, {
      value,
      expiresAt: ttlMs === Infinity ? 0 : Date.now() + ttlMs,
    });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Default no-op Redis client adapter. The real client is injected via
 * `options.redis` (expected to expose get/set/del/keys or scan).
 */
const noopRedis = {
  async get() {
    return null;
  },
  async set() {
    return 'OK';
  },
  async del() {
    return 0;
  },
  async keys() {
    return [];
  },
};

/**
 * Default no-op CDN adapter. Real adapter may expose `purge(urls)`.
 */
const noopCdn = {
  async purge() {
    return { purged: 0 };
  },
};

class CacheManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.l1 = new LruCache(options.l1MaxEntries || 1000);
    this.redis = options.redis || noopRedis;
    this.cdn = options.cdn || noopCdn;
    this.policies = { ...TTL_POLICIES, ...(options.policies || {}) };
    this.keyPrefix = options.keyPrefix || 'cache:';
    this.writeBehindQueue = [];
    this.writeBehindFlushIntervalMs = options.writeBehindFlushIntervalMs || 1000;
    this.writeBehindTimer = null;
    this.inFlight = new Map();
    this.stats = {
      l1: { hits: 0, misses: 0 },
      l2: { hits: 0, misses: 0 },
      l3: { hits: 0, misses: 0 },
      stampedePrevented: 0,
      writeThrough: 0,
      writeBehindQueued: 0,
      writeBehindFlushed: 0,
      invalidations: 0,
    };
    if (options.autoFlushWriteBehind !== false) {
      this._startWriteBehindFlush();
    }
  }

  _policy(dataType) {
    return this.policies[dataType] || this.policies.default;
  }

  _redisKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  _recordHit(layer) {
    this.stats[layer].hits += 1;
  }

  _recordMiss(layer) {
    this.stats[layer].misses += 1;
  }

  /**
   * Cache-aside read with single-flight stampede prevention.
   *
   * @param {string} key
   * @param {string} dataType
   * @param {Function} loader async () => value
   * @param {object} [opts]
   * @returns {Promise<*>}
   */
  async get(key, dataType, loader, opts = {}) {
    const policy = this._policy(dataType);

    // L1
    if (policy.l1TtlMs > 0) {
      const l1Value = this.l1.get(key);
      if (l1Value !== undefined) {
        this._recordHit('l1');
        return l1Value;
      }
      this._recordMiss('l1');
    }

    // L2
    if (policy.l2TtlMs > 0) {
      try {
        const raw = await this.redis.get(this._redisKey(key));
        if (raw !== null && raw !== undefined) {
          this._recordHit('l2');
          const value = this._deserialize(raw);
          if (policy.l1TtlMs > 0) this.l1.set(key, value, policy.l1TtlMs);
          return value;
        }
        this._recordMiss('l2');
      } catch (err) {
        this._recordMiss('l2');
        this.emit('error', { layer: 'l2', error: err });
      }
    }

    // Loader with single-flight.
    if (typeof loader !== 'function') {
      return undefined;
    }

    const flightKey = this._redisKey(key);
    if (this.inFlight.has(flightKey)) {
      this.stats.stampedePrevented += 1;
      return this.inFlight.get(flightKey);
    }

    const promise = (async () => {
      try {
        const value = await loader();
        if (value !== undefined) {
          await this.set(key, value, dataType, opts);
        }
        return value;
      } finally {
        this.inFlight.delete(flightKey);
      }
    })();

    this.inFlight.set(flightKey, promise);
    return promise;
  }

  /**
   * Write value into all applicable layers according to policy.
   */
  async set(key, value, dataType, opts = {}) {
    const policy = this._policy(dataType);
    const strategy = opts.strategy || policy.strategy;

    if (strategy === 'write-behind') {
      this.writeBehindQueue.push({ key, value, dataType, opts });
      this.stats.writeBehindQueued += 1;
      return;
    }

    // write-through / cache-aside both populate layers synchronously.
    if (policy.l1TtlMs > 0) {
      this.l1.set(key, value, policy.l1TtlMs);
    }
    if (policy.l2TtlMs > 0) {
      try {
        await this.redis.set(
          this._redisKey(key),
          this._serialize(value),
          'PX',
          policy.l2TtlMs
        );
      } catch (err) {
        this.emit('error', { layer: 'l2', error: err });
      }
    }
    if (strategy === 'write-through') {
      this.stats.writeThrough += 1;
    }
  }

  /**
   * Invalidate a key across all layers.
   */
  async invalidate(key, opts = {}) {
    this.stats.invalidations += 1;
    this.l1.delete(key);
    try {
      await this.redis.del(this._redisKey(key));
    } catch (err) {
      this.emit('error', { layer: 'l2', error: err });
    }
    if (opts.purgeCdn && opts.cdnUrls && opts.cdnUrls.length) {
      try {
        await this.cdn.purge(opts.cdnUrls);
      } catch (err) {
        this.emit('error', { layer: 'l3', error: err });
      }
    }
  }

  /**
   * Invalidate all keys matching a prefix (best-effort across layers).
   */
  async invalidatePrefix(prefix) {
    this.stats.invalidations += 1;
    const fullPrefix = this._redisKey(prefix);
    // L1: iterate keys.
    for (const k of Array.from(this.l1.map.keys())) {
      if (k.startsWith(prefix)) this.l1.delete(k);
    }
    // L2: scan/keys.
    try {
      const keys = await this.redis.keys(`${fullPrefix}*`);
      if (Array.isArray(keys)) {
        for (const k of keys) {
          await this.redis.del(k);
        }
      }
    } catch (err) {
      this.emit('error', { layer: 'l2', error: err });
    }
  }

  /**
   * Build CDN cache headers for a given data type.
   */
  cdnHeaders(dataType) {
    const policy = this._policy(dataType);
    if (!policy.l3TtlMs || policy.l3TtlMs <= 0) {
      return { 'Cache-Control': 'no-store' };
    }
    const maxAge = Math.floor(policy.l3TtlMs / 1000);
    return {
      'Cache-Control': `public, max-age=${maxAge}`,
      'Surrogate-Control': `max-age=${maxAge}`,
      'X-Cache-Data-Type': dataType,
    };
  }

  /**
   * Purge CDN URLs.
   */
  async purgeCdn(urls) {
    if (!urls || !urls.length) return { purged: 0 };
    try {
      return await this.cdn.purge(urls);
    } catch (err) {
      this.emit('error', { layer: 'l3', error: err });
      return { purged: 0, error: err.message };
    }
  }

  /**
   * Warm the cache by preloading a set of entries.
   * @param {Array<{key:string,dataType:string,loader:Function}>} entries
   */
  async warm(entries = []) {
    const results = [];
    for (const entry of entries) {
      try {
        const value = await this.get(entry.key, entry.dataType, entry.loader);
        results.push({ key: entry.key, ok: true, value });
      } catch (err) {
        results.push({ key: entry.key, ok: false, error: err.message });
      }
    }
    return results;
  }

  _serialize(value) {
    try {
      return JSON.stringify(value);
    } catch (err) {
      this.emit('error', { layer: 'serialize', error: err });
      return null;
    }
  }

  _deserialize(raw) {
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return raw;
    }
  }

  _startWriteBehindFlush() {
    if (this.writeBehindTimer) return;
    this.writeBehindTimer = setInterval(() => {
      this.flushWriteBehind().catch((err) => {
        this.emit('error', { layer: 'write-behind', error: err });
      });
    }, this.writeBehindFlushIntervalMs);
    if (typeof this.writeBehindTimer.unref === 'function') {
      this.writeBehindTimer.unref();
    }
  }

  /**
   * Flush queued write-behind entries into L2.
   */
  async flushWriteBehind() {
    if (!this.writeBehindQueue.length) return 0;
    const batch = this.writeBehindQueue.splice(0, this.writeBehindQueue.length);
    let flushed = 0;
    for (const item of batch) {
      const policy = this._policy(item.dataType);
      if (policy.l2TtlMs > 0) {
        try {
          await this.redis.set(
            this._redisKey(item.key),
            this._serialize(item.value),
            'PX',
            policy.l2TtlMs
          );
          flushed += 1;
        } catch (err) {
          this.emit('error', { layer: 'l2', error: err });
        }
      }
    }
    this.stats.writeBehindFlushed += flushed;
    return flushed;
  }

  /**
   * Return hit/miss statistics with computed hit rates.
   */
  getStats() {
    const rate = (layer) => {
      const { hits, misses } = this.stats[layer];
      const total = hits + misses;
      return total === 0 ? 0 : hits / total;
    };
    return {
      ...this.stats,
      l1HitRate: rate('l1'),
      l2HitRate: rate('l2'),
      l3HitRate: rate('l3'),
      l1Size: this.l1.size,
      writeBehindQueueSize: this.writeBehindQueue.length,
      inFlight: this.inFlight.size,
    };
  }

  resetStats() {
    for (const layer of ['l1', 'l2', 'l3']) {
      this.stats[layer].hits = 0;
      this.stats[layer].misses = 0;
    }
    this.stats.stampedePrevented = 0;
    this.stats.writeThrough = 0;
    this.stats.writeBehindQueued = 0;
    this.stats.writeBehindFlushed = 0;
    this.stats.invalidations = 0;
  }

  async close() {
    if (this.writeBehindTimer) {
      clearInterval(this.writeBehindTimer);
      this.writeBehindTimer = null;
    }
    await this.flushWriteBehind();
    this.l1.clear();
    this.inFlight.clear();
  }
}

let singleton = null;

/**
 * Get (or create) the singleton cache manager.
 */
function getCacheManager(options) {
  if (!singleton) {
    singleton = new CacheManager(options);
  }
  return singleton;
}

/**
 * Reset the singleton (useful for tests).
 */
function resetCacheManager() {
  if (singleton) {
    singleton.close().catch(() => {});
  }
  singleton = null;
}

/**
 * Access stats from the singleton.
 */
function getCacheStats() {
  return singleton ? singleton.getStats() : null;
}

module.exports = {
  CacheManager,
  LruCache,
  TTL_POLICIES,
  getCacheManager,
  resetCacheManager,
  getCacheStats,
};