import { AdvancedRateLimiter } from '../middleware/ratelimit.js';
import { QuotaTracker } from '../quota.js';

/**
 * Gateway rate limiting module.
 *
 * Wraps AdvancedRateLimiter (per-request rate limiting) and QuotaTracker
 * (longer-window quota accounting) into a single tenant-aware decision
 * pipeline. Quotas are resolved per tenant via req.tenantId and the
 * provided tenantRegistry.
 */

const DEFAULT_TENANT = 'default';

const DEFAULT_QUOTA = Object.freeze({
  requestsPerMinute: 600,
  requestsPerDay: 100000,
  burst: 100,
});

const DEFAULT_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 1000,
  max: 600,
});

function resolveTenantId(req) {
  if (!req) return DEFAULT_TENANT;
  const id =
    req.tenantId ||
    (req.tenant && req.tenant.id) ||
    (req.headers && (req.headers['x-tenant-id'] || req.headers['x-tenant'])) ||
    null;
  return id ? String(id) : DEFAULT_TENANT;
}

function resolveTenantConfig(tenantRegistry, tenantId) {
  if (!tenantRegistry) return null;
  try {
    if (typeof tenantRegistry.get === 'function') {
      return tenantRegistry.get(tenantId) || null;
    }
    if (typeof tenantRegistry.resolve === 'function') {
      return tenantRegistry.resolve(tenantId) || null;
    }
    if (typeof tenantRegistry === 'object' && tenantRegistry[tenantId]) {
      return tenantRegistry[tenantId];
    }
  } catch (_err) {
    return null;
  }
  return null;
}

function resolveQuota(tenantConfig) {
  const quota =
    (tenantConfig && (tenantConfig.quota || tenantConfig.quotas)) || {};
  return {
    requestsPerMinute:
      quota.requestsPerMinute != null
        ? quota.requestsPerMinute
        : DEFAULT_QUOTA.requestsPerMinute,
    requestsPerDay:
      quota.requestsPerDay != null
        ? quota.requestsPerDay
        : DEFAULT_QUOTA.requestsPerDay,
    burst: quota.burst != null ? quota.burst : DEFAULT_QUOTA.burst,
  };
}

function resolveRateLimitConfig(tenantConfig) {
  const rl =
    (tenantConfig && (tenantConfig.rateLimit || tenantConfig.rateLimits)) || {};
  return {
    windowMs:
      rl.windowMs != null ? rl.windowMs : DEFAULT_RATE_LIMIT.windowMs,
    max: rl.max != null ? rl.max : DEFAULT_RATE_LIMIT.max,
  };
}

function buildHeaders(decision) {
  const headers = {};
  if (decision.limit != null) headers['X-RateLimit-Limit'] = String(decision.limit);
  if (decision.remaining != null)
    headers['X-RateLimit-Remaining'] = String(Math.max(0, decision.remaining));
  if (decision.reset != null)
    headers['X-RateLimit-Reset'] = String(Math.ceil(decision.reset / 1000));
  if (decision.retryAfter != null)
    headers['Retry-After'] = String(Math.ceil(decision.retryAfter / 1000));
  if (decision.quotaLimit != null)
    headers['X-Quota-Limit'] = String(decision.quotaLimit);
  if (decision.quotaRemaining != null)
    headers['X-Quota-Remaining'] = String(Math.max(0, decision.quotaRemaining));
  return headers;
}

function buildRejectionPayload(decision) {
  return {
    error: 'rate_limit_exceeded',
    message: decision.message || 'Rate limit exceeded',
    reason: decision.reason || 'rate_limit',
    tenantId: decision.tenantId,
    limit: decision.limit,
    remaining: decision.remaining,
    reset: decision.reset,
    retryAfter: decision.retryAfter,
    quotaLimit: decision.quotaLimit,
    quotaRemaining: decision.quotaRemaining,
  };
}

export class GatewayRateLimiter {
  constructor(options = {}) {
    this.tenantRegistry = options.tenantRegistry || null;
    this.rateLimiter =
      options.rateLimiter ||
      new AdvancedRateLimiter(options.rateLimitOptions || {});
    this.quotaTracker =
      options.quotaTracker || new QuotaTracker(options.quotaOptions || {});
    this.now = options.now || (() => Date.now());
  }

  /**
   * Evaluate a request against tenant rate limits and quotas.
   * Returns a unified decision object.
   */
  async check(req, options = {}) {
    const tenantId = resolveTenantId(req);
    const tenantConfig = resolveTenantConfig(this.tenantRegistry, tenantId);
    const quota = resolveQuota(tenantConfig);
    const rateLimit = resolveRateLimitConfig(tenantConfig);
    const now = this.now();

    const decision = {
      allowed: true,
      tenantId,
      limit: rateLimit.max,
      remaining: null,
      reset: null,
      retryAfter: null,
      quotaLimit: quota.requestsPerMinute,
      quotaRemaining: null,
      reason: null,
      message: null,
      headers: {},
      payload: null,
    };

    // 1. Per-request rate limiting.
    let rateResult = null;
    try {
      rateResult = await this.rateLimiter.check(req, {
        key: options.key || tenantId,
        windowMs: rateLimit.windowMs,
        max: rateLimit.max,
        now,
      });
    } catch (_err) {
      rateResult = null;
    }

    if (rateResult) {
      if (rateResult.limit != null) decision.limit = rateResult.limit;
      if (rateResult.remaining != null) decision.remaining = rateResult.remaining;
      if (rateResult.reset != null) decision.reset = rateResult.reset;
      if (rateResult.retryAfter != null) decision.retryAfter = rateResult.retryAfter;
      if (rateResult.allowed === false) {
        decision.allowed = false;
        decision.reason = rateResult.reason || 'rate_limit';
        decision.message = rateResult.message || 'Rate limit exceeded';
      }
    }

    // 2. Quota accounting (only if rate limit passed).
    if (decision.allowed) {
      let quotaResult = null;
      try {
        quotaResult = await this.quotaTracker.consume(tenantId, {
          requestsPerMinute: quota.requestsPerMinute,
          requestsPerDay: quota.requestsPerDay,
          burst: quota.burst,
          now,
        });
      } catch (_err) {
        quotaResult = null;
      }

      if (quotaResult) {
        if (quotaResult.limit != null) decision.quotaLimit = quotaResult.limit;
        if (quotaResult.remaining != null)
          decision.quotaRemaining = quotaResult.remaining;
        if (quotaResult.allowed === false) {
          decision.allowed = false;
          decision.reason = quotaResult.reason || 'quota_exceeded';
          decision.message = quotaResult.message || 'Quota exceeded';
          if (quotaResult.retryAfter != null)
            decision.retryAfter = quotaResult.retryAfter;
        }
      }
    }

    decision.headers = buildHeaders(decision);
    if (!decision.allowed) {
      decision.payload = buildRejectionPayload(decision);
    }

    return decision;
  }

  /**
   * Express-style middleware. Attaches the decision to req.rateLimitDecision
   * and short-circuits with a 429 when rejected.
   */
  middleware() {
    return async (req, res, next) => {
      let decision;
      try {
        decision = await this.check(req);
      } catch (err) {
        return next(err);
      }

      req.rateLimitDecision = decision;

      if (decision.headers) {
        for (const [key, value] of Object.entries(decision.headers)) {
          try {
            res.setHeader(key, value);
          } catch (_err) {
            /* ignore header errors */
          }
        }
      }

      if (!decision.allowed) {
        const status = 429;
        if (typeof res.status === 'function') {
          res.status(status);
        } else {
          res.statusCode = status;
        }
        if (typeof res.json === 'function') {
          return res.json(decision.payload);
        }
        if (typeof res.send === 'function') {
          return res.send(decision.payload);
        }
        return res.end();
      }

      return next();
    };
  }
}

export function createGatewayRateLimiter(options = {}) {
  return new GatewayRateLimiter(options);
}

export default GatewayRateLimiter;