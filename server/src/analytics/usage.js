import { RATE_LIMIT_TIERS } from "../rate-limiter.js";

const PERIODS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const MAX_EVENTS_PER_KEY = 10_000;

/** Metering categories used for billing (#1119). */
export const METERING_CATEGORIES = {
  credential_issuance: ["POST /credentials", "POST /credentials/issue"],
  verification: ["POST /verify", "GET /verify"],
  did_resolution: ["GET /dids", "GET /dids/:id", "GET /resolve"],
  storage: ["POST /storage", "PUT /storage", "GET /storage"],
};

function categorize(endpoint) {
  for (const [category, endpoints] of Object.entries(METERING_CATEGORIES)) {
    if (endpoints.includes(endpoint)) return category;
  }
  return "other";
}

function monthKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per-key API usage tracker (#888). Keeps a bounded in-memory event log per
 * API key/user and aggregates it by endpoint and time period.
 */
export class UsageTracker {
  constructor({ maxEventsPerKey = MAX_EVENTS_PER_KEY } = {}) {
    this.maxEventsPerKey = maxEventsPerKey;
    this.events = new Map();
  }

  record(keyId, { method, path, statusCode, timestamp = Date.now(), tenantId, storageBytes = 0 }) {
    if (!keyId) return;
    let list = this.events.get(keyId);
    if (!list) this.events.set(keyId, (list = []));
    const endpoint = `${method} ${path}`;
    list.push({
      endpoint,
      category: categorize(endpoint),
      statusCode,
      timestamp,
      tenantId: tenantId ?? null,
      storageBytes: Number(storageBytes) || 0,
    });
    if (list.length > this.maxEventsPerKey) list.shift();
  }

  /** Aggregate metered usage (calls + storage) for a key over a time window. */
  getMeteredUsage(keyId, { since = 0, until = Date.now() } = {}) {
    const events = (this.events.get(keyId) ?? []).filter(
      (e) => e.timestamp >= since && e.timestamp <= until,
    );
    const byCategory = {};
    const byEndpoint = {};
    let storageBytes = 0;
    for (const e of events) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] ?? 0) + 1;
      storageBytes += e.storageBytes;
    }
    return { total: events.length, byCategory, byEndpoint, storageBytes };
  }

  /** Monthly rollup of metered usage for invoice generation. */
  getMonthlyUsage(keyId, { month, now = Date.now() } = {}) {
    const target = month ?? monthKey(now);
    const [year, mon] = target.split("-").map(Number);
    const since = Date.UTC(year, mon - 1, 1);
    const until = Date.UTC(year, mon, 1) - 1;
    return { month: target, ...this.getMeteredUsage(keyId, { since, until }) };
  }

  /** Aggregate usage across all keys belonging to a tenant for the dashboard. */
  getTenantUsage(tenantId, { since = 0, until = Date.now() } = {}) {
    const byCategory = {};
    const byEndpoint = {};
    let total = 0;
    let storageBytes = 0;
    for (const [keyId, list] of this.events) {
      for (const e of list) {
        if (e.tenantId !== tenantId) continue;
        if (e.timestamp < since || e.timestamp > until) continue;
        total += 1;
        byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
        byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] ?? 0) + 1;
        storageBytes += e.storageBytes;
        void keyId;
      }
    }
    return { tenantId, total, byCategory, byEndpoint, storageBytes };
  }

  getUsage(keyId, { period = "day", tier = "free", now = Date.now() } = {}) {
    const windowMs = PERIODS[period] ?? PERIODS.day;
    const since = now - windowMs;
    const recent = (this.events.get(keyId) ?? []).filter((e) => e.timestamp >= since);
    const byEndpoint = {};
    const bucketMs = period === "hour" ? 60_000 : period === "day" ? PERIODS.hour : PERIODS.day;
    const timeline = {};
    for (const e of recent) {
      byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] ?? 0) + 1;
      const bucket = new Date(Math.floor(e.timestamp / bucketMs) * bucketMs).toISOString();
      timeline[bucket] = (timeline[bucket] ?? 0) + 1;
    }
    const limits = RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS.free;
    const lastMinute = (this.events.get(keyId) ?? []).filter((e) => e.timestamp >= now - limits.windowMs).length;
    return {
      period,
      total: recent.length,
      byEndpoint,
      timeline: Object.entries(timeline).map(([time, count]) => ({ time, count })),
      rateLimit: {
        tier: limits.name,
        limit: limits.maxRequests,
        windowMs: limits.windowMs,
        used: lastMinute,
        remaining: Math.max(0, limits.maxRequests - lastMinute),
      },
    };
  }
}
