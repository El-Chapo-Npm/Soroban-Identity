import { logger } from '../logger.js';
import { TieredRateLimiter } from '../rate-limiter.js';

/**
 * Advanced multi-strategy rate limiting (#956)
 *
 * Layers four independent budgets in front of the existing tiered limiter:
 *
 *   1. Premium bypass  - premium/enterprise tiers and explicitly listed API
 *                        keys skip every check below (but are still counted).
 *   2. Per-IP          - token bucket keyed by client address, so one host
 *                        cannot exhaust capacity by rotating API keys.
 *   3. Per-user        - token bucket keyed by API key / user id, so one
 *                        account cannot exhaust capacity by rotating hosts.
 *   4. Endpoint + tier - delegated to TieredRateLimiter (#681), which already
 *                        owns the per-endpoint rules and subscription tiers.
 *
 * Buckets are token buckets rather than fixed windows: `ratePerMinute` sets the
 * sustained refill rate and `burst` sets how many extra requests may be spent
 * at once on top of it, so a client that has been idle can absorb a short
 * spike without being throttled.
 *
 * The result object keeps the shape `TieredRateLimiter.check` returns, so the
 * header and 429 handling in app.js works unchanged.
 */

export const DEFAULT_STRATEGIES = {
  ip: { ratePerMinute: 300, burst: 60 },
  user: { ratePerMinute: 600, burst: 120 },
};

export const DEFAULT_PREMIUM_TIERS = ['premium', 'enterprise'];

const RECENT_VIOLATION_LIMIT = 200;

function definedOnly(obj = {}) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined && v !== null));
}

export class TokenBucket {
  constructor({ ratePerMinute, burst = 0, now }) {
    this.capacity = ratePerMinute + burst;
    this.refillPerMs = ratePerMinute / 60_000;
    this.tokens = this.capacity;
    this.updatedAt = now;
  }

  refill(now) {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.updatedAt = now;
  }

  take(now) {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfter: 0 };
    }
    const msUntilToken = (1 - this.tokens) / this.refillPerMs;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(msUntilToken / 1000)) };
  }

  /** Epoch seconds at which the bucket will be full again. */
  resetAt(now) {
    const missing = this.capacity - this.tokens;
    return Math.ceil((now + missing / this.refillPerMs) / 1000);
  }

  isFull(now) {
    this.refill(now);
    return this.tokens >= this.capacity;
  }
}

export class AdvancedRateLimiter {
  /**
   * @param {object} [options]
   * @param {TieredRateLimiter} [options.tiered] - endpoint + tier limiter.
   * @param {{ip?: object, user?: object}} [options.strategies]
   * @param {string[]} [options.premiumTiers] - tiers that bypass all limits.
   * @param {string[]} [options.premiumKeys] - API key ids that bypass all limits.
   * @param {object} [options.metrics] - MetricsService, for Prometheus series.
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.tiered =
      options.tiered ??
      new TieredRateLimiter({
        whitelist: options.whitelist ?? [],
        trustProxy: options.trustProxy ?? false,
        maxBuckets: options.maxBuckets ?? 10_000,
        now: this.now,
      });
    this.strategies = {
      ip: { ...DEFAULT_STRATEGIES.ip, ...definedOnly(options.strategies?.ip) },
      user: { ...DEFAULT_STRATEGIES.user, ...definedOnly(options.strategies?.user) },
    };
    this.premiumTiers = new Set((options.premiumTiers ?? DEFAULT_PREMIUM_TIERS).map((t) => t.toLowerCase()));
    this.premiumKeys = new Set(options.premiumKeys ?? []);
    this.metrics = options.metrics ?? null;
    this.maxBuckets = options.maxBuckets ?? 10_000;

    this.buckets = { ip: new Map(), user: new Map() };
    this.stats = {
      allowed: 0,
      bypassed: 0,
      violations: { ip: 0, user: 0, endpoint: 0, tier: 0 },
    };
    this.recentViolations = [];
  }

  resolveUserKey(req) {
    const id = req.apiKeyId ?? req.auth?.apiKey?.id ?? req.userId ?? req.auth?.userId ?? null;
    return id ? String(id) : null;
  }

  isPremium(req) {
    const userKey = this.resolveUserKey(req);
    if (userKey && this.premiumKeys.has(userKey)) return true;
    // Only trust the tier from an authenticated key or an upstream-set
    // req.userTier; the client-supplied X-User-Tier header must never grant a
    // bypass on its own.
    const tier = req.userTier ?? req.auth?.apiKey?.tier ?? null;
    return tier ? this.premiumTiers.has(String(tier).toLowerCase()) : false;
  }

  takeFrom(strategy, key) {
    const map = this.buckets[strategy];
    const now = this.now();
    let bucket = map.get(key);
    if (!bucket) {
      if (map.size >= this.maxBuckets) this.evictIdle(strategy, now);
      bucket = new TokenBucket({ ...this.strategies[strategy], now });
      map.set(key, bucket);
    }
    const result = bucket.take(now);
    return {
      ...result,
      rule: strategy,
      limit: bucket.capacity,
      remaining: Math.floor(bucket.tokens),
      resetAt: bucket.resetAt(now),
    };
  }

  /** Drop full buckets: they hold no state a fresh bucket would not. */
  evictIdle(strategy, now = this.now()) {
    let evicted = 0;
    for (const [key, bucket] of this.buckets[strategy]) {
      if (bucket.isFull(now)) {
        this.buckets[strategy].delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  check(req, pathname) {
    if (this.isPremium(req)) {
      this.stats.bypassed += 1;
      this.metrics?.observeRateLimitDecision?.({ outcome: 'bypass', scope: 'premium' });
      return { allowed: true, whitelisted: true, bypass: 'premium', ip: this.tiered.resolveIp(req) };
    }

    const ip = this.tiered.resolveIp(req);

    const ipResult = this.takeFrom('ip', ip);
    if (!ipResult.allowed) return this.deny(req, pathname, ip, 'ip', ipResult);

    const userKey = this.resolveUserKey(req);
    const userResult = userKey ? this.takeFrom('user', userKey) : null;
    if (userResult && !userResult.allowed) return this.deny(req, pathname, ip, 'user', userResult);

    const tiered = this.tiered.check(req, pathname);
    if (!tiered.allowed) {
      // TieredRateLimiter logs its own violation; only record it here.
      this.track(req, pathname, ip, tiered.scope, tiered);
      return tiered;
    }

    if (tiered.whitelisted) {
      this.stats.bypassed += 1;
      this.metrics?.observeRateLimitDecision?.({ outcome: 'bypass', scope: 'whitelist' });
      return tiered;
    }

    this.stats.allowed += 1;
    this.metrics?.observeRateLimitDecision?.({ outcome: 'allowed', scope: 'all' });

    // Report whichever budget is closest to exhaustion.
    const candidates = [tiered.binding ?? tiered, ipResult, userResult].filter(Boolean);
    const binding = candidates.reduce((a, b) => (b.remaining < a.remaining ? b : a));
    return { ...tiered, binding };
  }

  deny(req, pathname, ip, scope, result) {
    logger.warn(
      {
        type: 'rate_limit_violation',
        scope,
        ip,
        userKey: this.resolveUserKey(req),
        method: req.method,
        path: pathname,
        limit: result.limit,
        retryAfter: result.retryAfter,
        userAgent: req.headers?.['user-agent'] ?? null,
      },
      'Rate limit exceeded',
    );
    this.track(req, pathname, ip, scope, result);
    return { ...result, allowed: false, scope, ip };
  }

  track(req, pathname, ip, scope, result) {
    this.stats.violations[scope] = (this.stats.violations[scope] ?? 0) + 1;
    this.metrics?.observeRateLimitDecision?.({ outcome: 'denied', scope });
    this.recentViolations.push({
      at: new Date(this.now()).toISOString(),
      scope,
      rule: result.rule ?? result.tier ?? scope,
      ip,
      userKey: this.resolveUserKey(req),
      method: req.method,
      path: pathname,
      limit: result.limit,
      retryAfter: result.retryAfter,
    });
    if (this.recentViolations.length > RECENT_VIOLATION_LIMIT) this.recentViolations.shift();
  }

  /** Snapshot for GET /admin/rate-limits. */
  getStats() {
    const totalViolations = Object.values(this.stats.violations).reduce((a, b) => a + b, 0);
    return {
      strategies: this.strategies,
      premiumTiers: [...this.premiumTiers],
      premiumKeys: this.premiumKeys.size,
      buckets: {
        ip: this.buckets.ip.size,
        user: this.buckets.user.size,
        tiered: this.tiered.getStats().buckets,
      },
      decisions: {
        allowed: this.stats.allowed,
        bypassed: this.stats.bypassed,
        denied: totalViolations,
      },
      violations: this.stats.violations,
      recentViolations: [...this.recentViolations].reverse(),
    };
  }

  reset() {
    this.buckets.ip.clear();
    this.buckets.user.clear();
    this.tiered.reset();
    this.stats = { allowed: 0, bypassed: 0, violations: { ip: 0, user: 0, endpoint: 0, tier: 0 } };
    this.recentViolations = [];
  }
}

/** Build a limiter from the server config (see config.js RATE_LIMIT_* vars). */
export function createRateLimiter(config, { metrics = null } = {}) {
  return new AdvancedRateLimiter({
    whitelist: config.rateLimitWhitelist ?? [],
    trustProxy: config.trustProxy ?? false,
    maxBuckets: config.rateLimitMaxBuckets ?? 10_000,
    strategies: {
      ip: { ratePerMinute: config.rateLimitIpPerMinute, burst: config.rateLimitIpBurst },
      user: { ratePerMinute: config.rateLimitUserPerMinute, burst: config.rateLimitUserBurst },
    },
    premiumTiers: config.rateLimitPremiumTiers,
    premiumKeys: config.rateLimitPremiumKeys,
    metrics,
  });
}
