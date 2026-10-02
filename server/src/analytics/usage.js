import { RATE_LIMIT_TIERS } from "../rate-limiter.js";

const PERIODS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const MAX_EVENTS_PER_KEY = 10_000;

/**
 * Per-key API usage tracker (#888). Keeps a bounded in-memory event log per
 * API key/user and aggregates it by endpoint and time period.
 */
export class UsageTracker {
  constructor({ maxEventsPerKey = MAX_EVENTS_PER_KEY } = {}) {
    this.maxEventsPerKey = maxEventsPerKey;
    this.events = new Map();
  }

  record(keyId, { method, path, statusCode, timestamp = Date.now() }) {
    if (!keyId) return;
    let list = this.events.get(keyId);
    if (!list) this.events.set(keyId, (list = []));
    list.push({ endpoint: `${method} ${path}`, statusCode, timestamp });
    if (list.length > this.maxEventsPerKey) list.shift();
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
