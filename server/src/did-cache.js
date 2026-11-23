import { RedisClient } from './redis-client.js';
import { logger } from './logger.js';

const KEY_PREFIX = 'did:doc:';
const META_PREFIX = 'did:meta:';

/**
 * Extract the DID method from a DID string (`did:<method>:...`).
 *
 * Returns `stellar` for bare Stellar addresses, since those are implicitly
 * `did:stellar` identifiers.
 */
export function didMethod(didOrAddress) {
  const value = String(didOrAddress ?? '');
  if (!value.startsWith('did:')) return 'stellar';
  const rest = value.slice('did:'.length);
  const separator = rest.indexOf(':');
  return separator === -1 ? rest : rest.slice(0, separator);
}

/**
 * Normalise a DID or bare Stellar address into a stable cache key.
 *
 * `did:stellar:G...` and a bare `G...` refer to the same document, so they must
 * not occupy two cache entries that can drift apart on invalidation. DIDs of
 * other methods (`did:ethr:...`, `did:web:...`, custom plugins) are keyed by
 * their full DID so distinct methods never collide.
 */
export function didCacheKey(didOrAddress) {
  const value = String(didOrAddress ?? '');
  if (value.startsWith('did:stellar:')) {
    return `${KEY_PREFIX}${value.slice('did:stellar:'.length)}`;
  }
  if (value.startsWith('did:')) {
    return `${KEY_PREFIX}${value}`;
  }
  return `${KEY_PREFIX}${value}`;
}

/**
 * Cache key for the resolver metadata stored alongside a DID document.
 */
export function didMetaKey(didOrAddress) {
  return `${META_PREFIX}${didCacheKey(didOrAddress).slice(KEY_PREFIX.length)}`;
}

/**
 * Redis-backed cache for resolved DID documents.
 *
 * Every operation degrades to a miss when Redis is unavailable: a cache outage
 * must slow the service down, never break it. Failures are counted and logged,
 * and the cache stops being consulted after repeated failures until a
 * reconnect succeeds, so a dead Redis does not add its timeout to every
 * request.
 */
export class DidCache {
  constructor(config, { client = null, metrics = null } = {}) {
    this.config = config;
    this.metrics = metrics;
    this.ttlMs = config.didCacheTtlMs ?? 60_000;
    this.enabled = Boolean(config.redisUrl);
    this.failureThreshold = config.cacheFailureThreshold ?? 3;

    this.client =
      client ??
      (this.enabled
        ? new RedisClient(config.redisUrl, {
            maxRetries: config.redisMaxRetries ?? 5,
            retryBaseMs: config.redisRetryBaseMs ?? 200,
            commandTimeoutMs: config.redisCommandTimeoutMs ?? 1000,
            enableAutoReconnect: config.redisEnableAutoReconnect ?? true,
            reconnectDelayMs: config.redisReconnectDelayMs ?? 1000,
          })
        : null);

    this.available = false;
    this.consecutiveFailures = 0;
    this.stats = { hits: 0, misses: 0, errors: 0, sets: 0, invalidations: 0 };
    // Bumped whenever resolver plugins or the fallback chain change, so
    // documents resolved under an old configuration can be discarded.
    this.resolverGeneration = 0;
  }

  /**
   * Connect to Redis. A failure here is logged and swallowed — the service
   * starts and runs uncached rather than refusing to boot.
   */
  async connect() {
    if (!this.enabled || !this.client) {
      logger.info('DID cache disabled (REDIS_URL is not configured)');
      return false;
    }
    try {
      await this.client.connect();
      this.available = true;
      this.consecutiveFailures = 0;
      logger.info({ ttlMs: this.ttlMs }, 'DID cache connected');
      return true;
    } catch (error) {
      this.available = false;
      logger.error({ error: error.message }, 'DID cache unavailable; continuing without cache');
      return false;
    }
  }

  /**
   * Whether a cache operation should even be attempted.
   */
  get usable() {
    return this.enabled && this.available && this.consecutiveFailures < this.failureThreshold;
  }

  _recordMetric(name) {
    if (this.metrics && typeof this.metrics.counters === 'object') {
      this.metrics.counters[name] = (this.metrics.counters[name] ?? 0) + 1;
    }
  }

  /**
   * Record a cache-layer failure. After `failureThreshold` consecutive
   * failures the cache is marked unusable and a reconnect is attempted in the
   * background, so requests stop paying the Redis timeout.
   */
  _recordFailure(operation, error) {
    this.stats.errors += 1;
    this.consecutiveFailures += 1;
    this._recordMetric('did_cache_errors_total');
    logger.warn(
      { operation, error: error.message, consecutiveFailures: this.consecutiveFailures },
      'DID cache operation failed',
    );

    if (this.consecutiveFailures === this.failureThreshold) {
      logger.error(
        { failureThreshold: this.failureThreshold },
        'DID cache disabled after repeated failures; attempting reconnect in the background',
      );
      this.available = false;
      void this._reconnect();
    }
  }

  async _reconnect() {
    try {
      await this.client.connect();
      this.available = true;
      this.consecutiveFailures = 0;
      logger.info('DID cache reconnected');
    } catch (error) {
      logger.warn({ error: error.message }, 'DID cache reconnect failed');
    }
  }

  /**
   * Read a cached DID document.
   *
   * @returns {Promise<object|null>} The document, or null on a miss, a parse
   *   failure, or any cache error.
   */
  async get(didOrAddress) {
    const entry = await this.getEntry(didOrAddress);
    return entry ? entry.document : null;
  }

  /**
   * Read a cached DID document together with its resolver metadata.
   *
   * @returns {Promise<{document: object, meta: object}|null>}
   */
  async getEntry(didOrAddress) {
    if (!this.usable) return null;

    try {
      const raw = await this.client.get(didCacheKey(didOrAddress));
      if (raw === null || raw === undefined) {
        this.stats.misses += 1;
        this._recordMetric('did_cache_misses_total');
        return null;
      }

      this.consecutiveFailures = 0;
      this.stats.hits += 1;
      this._recordMetric('did_cache_hits_total');
      const parsed = JSON.parse(raw);
      // Entries written before metadata support hold the bare document.
      if (parsed && typeof parsed === 'object' && 'document' in parsed) {
        return { document: parsed.document, meta: parsed.meta ?? {} };
      }
      return { document: parsed, meta: {} };
    } catch (error) {
      if (error instanceof SyntaxError) {
        // A corrupt entry is treated as a miss and dropped, rather than
        // poisoning every subsequent read of that DID.
        this.stats.misses += 1;
        this._recordMetric('did_cache_misses_total');
        void this.invalidate(didOrAddress);
        return null;
      }
      this._recordFailure('get', error);
      return null;
    }
  }

  /**
   * Cache a resolved DID document with a TTL.
   *
   * `meta` records how the document was produced (resolver method, plugin
   * name, whether a fallback was used) so callers can reason about staleness
   * and the resolver generation that produced it.
   */
  async set(didOrAddress, document, ttlMs = this.ttlMs, meta = {}) {
    if (!this.usable || document === null || document === undefined) return false;

    const entry = {
      document,
      meta: {
        method: didMethod(didOrAddress),
        resolverGeneration: this.resolverGeneration,
        resolvedAt: Date.now(),
        ...meta,
      },
    };

    try {
      await this.client.set(didCacheKey(didOrAddress), JSON.stringify(entry), ttlMs);
      this.consecutiveFailures = 0;
      this.stats.sets += 1;
      this._recordMetric('did_cache_sets_total');
      return true;
    } catch (error) {
      this._recordFailure('set', error);
      return false;
    }
  }

  /**
   * Drop one DID from the cache. Call this whenever a DID is created or
   * updated, so a stale document cannot outlive the write that changed it.
   */
  async invalidate(didOrAddress) {
    if (!this.enabled || !this.client) return false;

    try {
      await this.client.del(didCacheKey(didOrAddress));
      this.stats.invalidations += 1;
      this._recordMetric('did_cache_invalidations_total');
      return true;
    } catch (error) {
      this._recordFailure('invalidate', error);
      return false;
    }
  }

  /**
   * Drop every cached DID document. Uses SCAN rather than KEYS so a large
   * keyspace does not block the Redis event loop.
   */
  async invalidateAll() {
    if (!this.usable) return 0;

    try {
      const keys = await this.client.scanKeys(`${KEY_PREFIX}*`);
      if (keys.length === 0) return 0;
      await this.client.del(...keys);
      this.stats.invalidations += keys.length;
      logger.info({ count: keys.length }, 'DID cache flushed');
      return keys.length;
    } catch (error) {
      this._recordFailure('invalidateAll', error);
      return 0;
    }
  }

  /**
   * Drop every cached document for one DID method (e.g. after a resolver
   * plugin for that method is registered, replaced or removed).
   *
   * @param {string} method  The DID method, without the `did:` prefix.
   */
  async invalidateMethod(method) {
    if (!this.usable) return 0;

    try {
      const keys = await this.client.scanKeys(`${KEY_PREFIX}*`);
      const matching = keys.filter((key) => {
        const id = key.slice(KEY_PREFIX.length);
        return didMethod(id.startsWith('did:') ? id : `did:stellar:${id}`) === method;
      });
      if (matching.length === 0) return 0;
      await this.client.del(...matching);
      this.stats.invalidations += matching.length;
      this._recordMetric('did_cache_method_invalidations_total');
      logger.info({ method, count: matching.length }, 'DID cache invalidated for method');
      return matching.length;
    } catch (error) {
      this._recordFailure('invalidateMethod', error);
      return 0;
    }
  }

  /**
   * Hook for resolver plugin changes: bump the resolver generation and drop
   * every cached document, since any of them may have been produced by the
   * plugin that just changed.
   */
  async onResolverPluginsChanged() {
    this.resolverGeneration += 1;
    logger.info({ resolverGeneration: this.resolverGeneration }, 'Resolver plugins changed; flushing DID cache');
    return this.invalidateAll();
  }

  /**
   * Hook for fallback chain changes: bump the resolver generation and drop
   * every cached document, since resolution order may now yield different
   * results for the same DID.
   */
  async onFallbackChainChanged() {
    this.resolverGeneration += 1;
    logger.info(
      { resolverGeneration: this.resolverGeneration },
      'Resolver fallback chain changed; flushing DID cache',
    );
    return this.invalidateAll();
  }

  /**
   * Pre-populate the cache for a set of DIDs.
   *
   * Resolution failures are counted and skipped rather than aborting the warm,
   * so one bad DID cannot prevent the rest from being cached.
   *
   * @param {string[]} dids
   * @param {(did: string) => Promise<object|null>} resolve
   */
  async warm(dids, resolve) {
    if (!this.usable || !Array.isArray(dids) || dids.length === 0) {
      return { warmed: 0, failed: 0, skipped: dids?.length ?? 0 };
    }

    let warmed = 0;
    let failed = 0;

    for (const did of dids) {
      try {
        const document = await resolve(did);
        if (document) {
          await this.set(did, document);
          warmed += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        logger.warn({ did, error: error.message }, 'DID cache warm failed for one entry');
      }
    }

    logger.info({ warmed, failed, total: dids.length }, 'DID cache warm complete');
    return { warmed, failed, skipped: 0 };
  }

  /**
   * Hit/miss counters plus a derived hit rate, for the metrics endpoint.
   */
  getStats() {
    const lookups = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      enabled: this.enabled,
      available: this.available,
      ttlMs: this.ttlMs,
      resolverGeneration: this.resolverGeneration,
      hitRate: lookups === 0 ? 0 : Number((this.stats.hits / lookups).toFixed(4)),
    };
  }

  async close() {
    if (this.client) await this.client.quit();
    this.available = false;
  }
}
