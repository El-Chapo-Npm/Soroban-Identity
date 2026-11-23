'use strict';

const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');

/**
 * Cache invalidation pipeline.
 *
 * Coordinates invalidation across all cache layers:
 *  - L1 (in-memory) entries are cleared directly.
 *  - L2 (Redis) keys are deleted and an invalidation event is published
 *    on Redis pub/sub so other instances can drop their L1 entries.
 *  - L3 (CDN) is purged via the existing purge-cache.sh script.
 *
 * Also hosts the warming scheduler which uses cache/warming.js to preload
 * popular DIDs and query results on startup and on a cron schedule.
 */

const INVALIDATION_CHANNEL = 'cache:invalidation';
const DEFAULT_WARMING_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_CDN_PURGE_TIMEOUT_MS = 30 * 1000;

/**
 * Lazily resolve dependencies so that this module can be required in
 * environments where Redis or the warming module are not yet available.
 */
function loadDependency(modulePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (err) {
    return null;
  }
}

function resolvePurgeScriptPath() {
  const candidates = [
    path.resolve(__dirname, '../../../scripts/purge-cache.sh'),
    path.resolve(__dirname, '../../scripts/purge-cache.sh'),
    path.resolve(process.cwd(), 'scripts/purge-cache.sh'),
  ];
  const fs = loadDependency('fs');
  if (fs) {
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (err) {
        // ignore and continue
      }
    }
  }
  return candidates[0];
}

class CacheInvalidationPipeline extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.l1Cache] L1 in-memory cache instance (must expose delete/clear).
   * @param {Object} [options.redis] Redis client (ioredis compatible) with pub/sub support.
   * @param {Object} [options.redisSubscriber] Dedicated subscriber client for pub/sub.
   * @param {Object} [options.warming] Warming module (defaults to cache/warming.js).
   * @param {string} [options.purgeScriptPath] Path to purge-cache.sh.
   * @param {number} [options.warmingIntervalMs] Cron-like interval for warming.
   * @param {number} [options.cdnPurgeTimeoutMs] Timeout for the CDN purge script.
   * @param {Object} [options.logger] Logger instance.
   */
  constructor(options = {}) {
    super();
    this.l1Cache = options.l1Cache || null;
    this.redis = options.redis || null;
    this.redisSubscriber = options.redisSubscriber || null;
    this.warming = options.warming || loadDependency('./warming');
    this.purgeScriptPath = options.purgeScriptPath || resolvePurgeScriptPath();
    this.warmingIntervalMs = options.warmingIntervalMs || DEFAULT_WARMING_INTERVAL_MS;
    this.cdnPurgeTimeoutMs = options.cdnPurgeTimeoutMs || DEFAULT_CDN_PURGE_TIMEOUT_MS;
    this.logger = options.logger || console;

    this.instanceId = crypto.randomBytes(8).toString('hex');
    this.warmingTimer = null;
    this.subscribed = false;
    this.started = false;
    this._boundMessageHandler = this._handlePubSubMessage.bind(this);
  }

  /**
   * Start the pipeline: subscribe to Redis pub/sub and schedule warming.
   */
  async start() {
    if (this.started) {
      return;
    }
    this.started = true;

    await this._subscribe();
    this._scheduleWarming();

    // Warm on startup (fire-and-forget; failures are logged).
    this.warmNow().catch((err) => {
      this._log('error', 'Startup cache warming failed', err);
    });
  }

  /**
   * Stop the pipeline: unsubscribe and clear timers.
   */
  async stop() {
    this.started = false;
    this._clearWarmingTimer();

    if (this.subscribed && this.redisSubscriber) {
      try {
        await this.redisSubscriber.unsubscribe(INVALIDATION_CHANNEL);
        if (typeof this.redisSubscriber.removeListener === 'function') {
          this.redisSubscriber.removeListener('message', this._boundMessageHandler);
        }
      } catch (err) {
        this._log('warn', 'Failed to unsubscribe from invalidation channel', err);
      }
      this.subscribed = false;
    }
  }

  /**
   * Invalidate one or more cache keys across all layers.
   *
   * @param {string|string[]} keys Cache keys to invalidate.
   * @param {Object} [opts]
   * @param {boolean} [opts.purgeCdn=false] Whether to purge the CDN for these keys.
   * @param {boolean} [opts.publish=true] Whether to publish the event on Redis pub/sub.
   * @param {string} [opts.reason] Human-readable reason for the invalidation.
   * @returns {Promise<Object>} Summary of the invalidation.
   */
  async invalidate(keys, opts = {}) {
    const keyList = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    if (keyList.length === 0) {
      return { keys: [], l1: 0, l2: 0, cdn: false, published: false };
    }

    const {
      purgeCdn = false,
      publish = true,
      reason = 'manual',
    } = opts;

    const result = {
      keys: keyList,
      l1: 0,
      l2: 0,
      cdn: false,
      published: false,
      reason,
    };

    // L1: clear in-memory entries.
    result.l1 = this._clearL1(keyList);

    // L2: delete Redis keys.
    result.l2 = await this._clearL2(keyList);

    // Publish invalidation event so other instances drop their L1 entries.
    if (publish) {
      result.published = await this._publish({
        type: 'invalidate',
        keys: keyList,
        reason,
        source: this.instanceId,
        timestamp: Date.now(),
      });
    }

    // L3: purge CDN.
    if (purgeCdn) {
      result.cdn = await this.purgeCdn(keyList);
    }

    this.emit('invalidated', result);
    return result;
  }

  /**
   * Invalidate everything (e.g. after a deploy or schema change).
   */
  async invalidateAll(opts = {}) {
    const { purgeCdn = true, publish = true, reason = 'invalidate-all' } = opts;

    let l1 = 0;
    if (this.l1Cache && typeof this.l1Cache.clear === 'function') {
      try {
        this.l1Cache.clear();
        l1 = 1;
      } catch (err) {
        this._log('warn', 'Failed to clear L1 cache', err);
      }
    }

    let l2 = 0;
    if (this.redis && typeof this.redis.flushdb === 'function') {
      try {
        await this.redis.flushdb();
        l2 = 1;
      } catch (err) {
        this._log('warn', 'Failed to flush L2 cache', err);
      }
    }

    let published = false;
    if (publish) {
      published = await this._publish({
        type: 'invalidate-all',
        reason,
        source: this.instanceId,
        timestamp: Date.now(),
      });
    }

    let cdn = false;
    if (purgeCdn) {
      cdn = await this.purgeCdn([]);
    }

    const result = { l1, l2, cdn, published, reason };
    this.emit('invalidated', result);
    return result;
  }

  /**
   * Purge the CDN via purge-cache.sh.
   *
   * @param {string[]} keys Keys/URLs to purge. Empty array purges everything.
   * @returns {Promise<boolean>} Whether the purge succeeded.
   */
  purgeCdn(keys = []) {
    return new Promise((resolve) => {
      const args = [];
      if (Array.isArray(keys) && keys.length > 0) {
        args.push(...keys);
      } else {
        args.push('--all');
      }

      const child = execFile(
        this.purgeScriptPath,
        args,
        { timeout: this.cdnPurgeTimeoutMs },
        (err, stdout, stderr) => {
          if (err) {
            this._log('warn', 'CDN purge failed', {
              error: err.message,
              stderr: stderr ? String(stderr).trim() : undefined,
            });
            this.emit('cdn-purge-failed', { keys, error: err });
            resolve(false);
            return;
          }
          this._log('info', 'CDN purge succeeded', {
            keys: keys.length > 0 ? keys : 'all',
            stdout: stdout ? String(stdout).trim() : undefined,
          });
          this.emit('cdn-purged', { keys });
          resolve(true);
        }
      );

      if (child && typeof child.on === 'function') {
        child.on('error', (err) => {
          this._log('warn', 'CDN purge script error', err);
          resolve(false);
        });
      }
    });
  }

  /**
   * Run cache warming immediately.
   */
  async warmNow() {
    if (!this.warming) {
      this._log('debug', 'Warming module unavailable; skipping warm');
      return { skipped: true };
    }

    try {
      let result;
      if (typeof this.warming.warmAll === 'function') {
        result = await this.warming.warmAll();
      } else if (typeof this.warming.warm === 'function') {
        result = await this.warming.warm();
      } else if (typeof this.warming === 'function') {
        result = await this.warming();
      } else {
        this._log('debug', 'Warming module exposes no warm function; skipping');
        return { skipped: true };
      }
      this.emit('warmed', result);
      return result;
    } catch (err) {
      this._log('error', 'Cache warming failed', err);
      this.emit('warming-failed', err);
      throw err;
    }
  }

  /**
   * Schedule periodic warming.
   */
  _scheduleWarming() {
    this._clearWarmingTimer();
    if (!this.warmingIntervalMs || this.warmingIntervalMs <= 0) {
      return;
    }
    this.warmingTimer = setInterval(() => {
      this.warmNow().catch((err) => {
        this._log('error', 'Scheduled cache warming failed', err);
      });
    }, this.warmingIntervalMs);
    if (typeof this.warmingTimer.unref === 'function') {
      this.warmingTimer.unref();
    }
  }

  _clearWarmingTimer() {
    if (this.warmingTimer) {
      clearInterval(this.warmingTimer);
      this.warmingTimer = null;
    }
  }

  async _subscribe() {
    if (!this.redisSubscriber || typeof this.redisSubscriber.subscribe !== 'function') {
      this._log('debug', 'No Redis subscriber configured; pub/sub disabled');
      return;
    }
    try {
      if (typeof this.redisSubscriber.on === 'function') {
        this.redisSubscriber.on('message', this._boundMessageHandler);
      }
      await this.redisSubscriber.subscribe(INVALIDATION_CHANNEL);
      this.subscribed = true;
    } catch (err) {
      this._log('warn', 'Failed to subscribe to invalidation channel', err);
    }
  }

  _handlePubSubMessage(channel, message) {
    if (channel !== INVALIDATION_CHANNEL) {
      return;
    }
    let payload;
    try {
      payload = typeof message === 'string' ? JSON.parse(message) : message;
    } catch (err) {
      this._log('warn', 'Received malformed invalidation message', err);
      return;
    }
    if (!payload || payload.source === this.instanceId) {
      // Ignore our own messages.
      return;
    }

    if (payload.type === 'invalidate-all') {
      if (this.l1Cache && typeof this.l1Cache.clear === 'function') {
        try {
          this.l1Cache.clear();
        } catch (err) {
          this._log('warn', 'Failed to clear L1 cache from pub/sub', err);
        }
      }
      this.emit('remote-invalidated', payload);
      return;
    }

    if (payload.type === 'invalidate' && Array.isArray(payload.keys)) {
      this._clearL1(payload.keys);
      this.emit('remote-invalidated', payload);
    }
  }

  async _publish(payload) {
    if (!this.redis || typeof this.redis.publish !== 'function') {
      return false;
    }
    try {
      await this.redis.publish(INVALIDATION_CHANNEL, JSON.stringify(payload));
      return true;
    } catch (err) {
      this._log('warn', 'Failed to publish invalidation event', err);
      return false;
    }
  }

  _clearL1(keys) {
    if (!this.l1Cache) {
      return 0;
    }
    let cleared = 0;
    for (const key of keys) {
      try {
        if (typeof this.l1Cache.delete === 'function') {
          if (this.l1Cache.delete(key)) {
            cleared += 1;
          }
        } else if (typeof this.l1Cache.del === 'function') {
          this.l1Cache.del(key);
          cleared += 1;
        }
      } catch (err) {
        this._log('warn', `Failed to clear L1 key ${key}`, err);
      }
    }
    return cleared;
  }

  async _clearL2(keys) {
    if (!this.redis || typeof this.redis.del !== 'function') {
      return 0;
    }
    try {
      const result = await this.redis.del(...keys);
      return typeof result === 'number' ? result : keys.length;
    } catch (err) {
      this._log('warn', 'Failed to clear L2 keys', err);
      return 0;
    }
  }

  _log(level, message, meta) {
    const logger = this.logger || console;
    const fn = typeof logger[level] === 'function' ? logger[level] : logger.log;
    if (typeof fn === 'function') {
      try {
        if (meta !== undefined) {
          fn.call(logger, `[cache-invalidation] ${message}`, meta);
        } else {
          fn.call(logger, `[cache-invalidation] ${message}`);
        }
      } catch (err) {
        // Never let logging break the pipeline.
      }
    }
  }
}

/**
 * Create a singleton pipeline instance.
 */
let defaultPipeline = null;

function getPipeline(options) {
  if (!defaultPipeline) {
    defaultPipeline = new CacheInvalidationPipeline(options);
  }
  return defaultPipeline;
}

module.exports = {
  CacheInvalidationPipeline,
  getPipeline,
  INVALIDATION_CHANNEL,
  DEFAULT_WARMING_INTERVAL_MS,
};