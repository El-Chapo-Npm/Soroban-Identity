import { logger } from './logger.js';
import { renderQuotaSubject, renderQuotaBody } from './email.js';

/**
 * API Quota Tracking (#748)
 *
 * Deliberately independent of the tiered rate limiter (rate-limiter.js):
 * rate limiting protects the server from bursts on a rolling per-minute
 * window, while quotas are a billing concern measured against calendar
 * day/month boundaries. A client can be well under its rate limit and still
 * be over quota, or vice versa, so the two checks are kept as separate
 * budgets that a request must satisfy independently.
 */

export const QUOTA_TIERS = {
  free: { name: 'free', dailyLimit: 1_000, monthlyLimit: 20_000 },
  pro: { name: 'pro', dailyLimit: 20_000, monthlyLimit: 400_000 },
  enterprise: { name: 'enterprise', dailyLimit: 200_000, monthlyLimit: 4_000_000 },
};

/** Fractions of a period's limit that trigger a usage notification. */
export const QUOTA_WARNING_THRESHOLDS = [0.8, 1.0];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function startOfNextUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function startOfNextUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export class QuotaTracker {
  /**
   * @param {object} [options]
   * @param {Record<string,{name:string,dailyLimit:number,monthlyLimit:number}>} [options.tiers]
   * @param {() => number} [options.now] - Injectable clock for tests
   * @param {'block'|'allow'} [options.overageMode] - Whether a request over
   *   quota is rejected outright ('block') or allowed through flagged as
   *   overage ('allow'), e.g. for a tier billed for overage rather than
   *   capped by it.
   * @param {(info: object) => void|Promise<void>} [options.onThreshold] -
   *   Called (fire-and-forget from the tracker's perspective) the first time
   *   a period's usage crosses 80% or 100% of its limit.
   * @param {number} [options.maxBuckets] - Upper bound on tracked clients,
   *   mirroring TieredRateLimiter's bucket cap so an unbounded stream of
   *   distinct clients cannot grow memory without limit.
   */
  constructor(options = {}) {
    this.tiers = options.tiers ?? QUOTA_TIERS;
    this.now = options.now ?? (() => Date.now());
    this.overageMode = options.overageMode === 'allow' ? 'allow' : 'block';
    this.onThreshold = options.onThreshold ?? null;
    this.maxBuckets = options.maxBuckets ?? 10_000;
    this.clients = new Map();
  }

  resolveTier(req) {
    if (req.userTier && this.tiers[req.userTier.toLowerCase()]) {
      return req.userTier.toLowerCase();
    }
    if (req.auth?.apiKey?.tier && this.tiers[req.auth.apiKey.tier.toLowerCase()]) {
      return req.auth.apiKey.tier.toLowerCase();
    }
    const headerTier = req.headers?.['x-user-tier']?.toLowerCase();
    if (headerTier && this.tiers[headerTier]) return headerTier;
    return 'free';
  }

  getClientKey(req) {
    if (req.apiKeyId) return `key:${req.apiKeyId}`;
    if (req.auth?.apiKey?.id) return `key:${req.auth.apiKey.id}`;
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown');
    return `ip:${ip}`;
  }

  /**
   * Fetch (creating if absent) a client's counter state, rolling each period
   * over to zero if its calendar boundary has passed. Rolling over lazily on
   * access — rather than on a timer — is the same "reset schedule" strategy
   * TieredRateLimiter uses for its windows: no background job is needed for
   * correctness, only the opportunistic eviction below for memory hygiene.
   */
  getOrInitState(key, tierName, now) {
    let state = this.clients.get(key);
    const nowDate = new Date(now);
    if (!state) {
      if (this.clients.size >= this.maxBuckets) this.evictExpired(now);
      state = {
        tier: tierName,
        dailyCount: 0,
        dailyResetAt: startOfNextUtcDay(nowDate).getTime(),
        monthlyCount: 0,
        monthlyResetAt: startOfNextUtcMonth(nowDate).getTime(),
        notifiedDaily: new Set(),
        notifiedMonthly: new Set(),
      };
      this.clients.set(key, state);
    }
    if (now >= state.dailyResetAt) {
      state.dailyCount = 0;
      state.dailyResetAt = startOfNextUtcDay(nowDate).getTime();
      state.notifiedDaily = new Set();
    }
    if (now >= state.monthlyResetAt) {
      state.monthlyCount = 0;
      state.monthlyResetAt = startOfNextUtcMonth(nowDate).getTime();
      state.notifiedMonthly = new Set();
    }
    state.tier = tierName;
    return state;
  }

  /** Drop buckets whose monthly window rolled over more than a day ago. */
  evictExpired(now = this.now()) {
    let evicted = 0;
    for (const [key, state] of this.clients) {
      if (now >= state.monthlyResetAt + ONE_DAY_MS) {
        this.clients.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  describe(state, tier) {
    return {
      tier: state.tier,
      daily: {
        limit: tier.dailyLimit,
        used: state.dailyCount,
        remaining: Math.max(0, tier.dailyLimit - state.dailyCount),
        resetAt: Math.ceil(state.dailyResetAt / 1000),
      },
      monthly: {
        limit: tier.monthlyLimit,
        used: state.monthlyCount,
        remaining: Math.max(0, tier.monthlyLimit - state.monthlyCount),
        resetAt: Math.ceil(state.monthlyResetAt / 1000),
      },
    };
  }

  /** Read current usage without consuming a unit of quota. */
  peek(req) {
    const tierName = this.resolveTier(req);
    const tier = this.tiers[tierName] ?? this.tiers.free;
    const key = this.getClientKey(req);
    const state = this.getOrInitState(key, tierName, this.now());
    return this.describe(state, tier);
  }

  /**
   * Consume one unit of quota for this request.
   *
   * @returns {{allowed:boolean, overage:boolean, scope:'daily'|'monthly'|null, tier:string, daily:object, monthly:object}}
   */
  consume(req) {
    const tierName = this.resolveTier(req);
    const tier = this.tiers[tierName] ?? this.tiers.free;
    const key = this.getClientKey(req);
    const apiKeyId = req.apiKeyId ?? req.auth?.apiKey?.id ?? null;
    const now = this.now();
    const state = this.getOrInitState(key, tierName, now);

    const wouldExceedDaily = state.dailyCount + 1 > tier.dailyLimit;
    const wouldExceedMonthly = state.monthlyCount + 1 > tier.monthlyLimit;
    const overage = wouldExceedDaily || wouldExceedMonthly;
    const blocked = overage && this.overageMode === 'block';

    if (!blocked) {
      state.dailyCount += 1;
      state.monthlyCount += 1;
    }

    this.checkThresholds({ key, apiKeyId, state, tier });

    return {
      allowed: !blocked,
      overage,
      scope: overage ? (wouldExceedDaily ? 'daily' : 'monthly') : null,
      ...this.describe(state, tier),
    };
  }

  /** Fire the threshold callback (once per period per threshold) at 80%/100% usage. */
  checkThresholds({ key, apiKeyId, state, tier }) {
    if (!this.onThreshold) return;

    const periods = [
      ['daily', state.dailyCount, tier.dailyLimit, state.notifiedDaily],
      ['monthly', state.monthlyCount, tier.monthlyLimit, state.notifiedMonthly],
    ];

    for (const [period, used, limit, notified] of periods) {
      if (limit <= 0) continue;
      const fraction = used / limit;
      for (const threshold of QUOTA_WARNING_THRESHOLDS) {
        if (fraction < threshold || notified.has(threshold)) continue;
        notified.add(threshold);
        try {
          const result = this.onThreshold({ key, apiKeyId, tier: state.tier, period, threshold, used, limit });
          if (result && typeof result.then === 'function') {
            result.catch((error) =>
              logger.error({ error: error.message, key, period, threshold }, 'Quota threshold callback rejected'),
            );
          }
        } catch (error) {
          logger.error({ error: error.message, key, period, threshold }, 'Quota threshold callback failed');
        }
      }
    }
  }

  reset() {
    this.clients.clear();
  }

  getStats() {
    return { buckets: this.clients.size, overageMode: this.overageMode };
  }
}

/**
 * Pick whichever period (daily or monthly) is proportionally closer to
 * exhaustion, so the headers a client sees reflect the budget that will
 * actually stop it first — the same rationale TieredRateLimiter uses to pick
 * between its endpoint and tier budgets.
 */
export function pickQuotaBinding(usage) {
  const dailyFraction = usage.daily.limit > 0 ? usage.daily.remaining / usage.daily.limit : 1;
  const monthlyFraction = usage.monthly.limit > 0 ? usage.monthly.remaining / usage.monthly.limit : 1;
  return dailyFraction <= monthlyFraction
    ? { period: 'daily', ...usage.daily }
    : { period: 'monthly', ...usage.monthly };
}

/**
 * Resolve a notification recipient for an API key and deliver the
 * 80%/100% quota email. Best-effort: a missing transport, key record, or
 * recipient address is a silent no-op rather than a failure.
 */
export async function notifyQuotaThresholdOwner({ config, apiKeyService, emailTransport, apiKeyId, tier, period, threshold, used, limit }) {
  if (!emailTransport?.enabled || !apiKeyService || !apiKeyId) return;

  const record = await apiKeyService.getKey(apiKeyId);
  const recipient = (record?.owner && record.owner.includes('@')) ? record.owner : (config.notificationEmail || null);
  if (!recipient) return;

  const subject = renderQuotaSubject({ tier, period, threshold });
  const { text, html } = renderQuotaBody({ tier, period, threshold, used, limit });

  try {
    await emailTransport.send({ to: recipient, subject, text, html });
    logger.info({ apiKeyId, tier, period, threshold, recipient }, 'Quota threshold notification delivered');
  } catch (error) {
    logger.error({ apiKeyId, tier, period, threshold, error: error.message }, 'Quota threshold notification failed');
  }
}
