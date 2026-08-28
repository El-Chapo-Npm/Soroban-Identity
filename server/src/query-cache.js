export class QueryResultCache {
  constructor(config = {}, { redisClient = null, metrics = null, now = () => Date.now() } = {}) {
    this.enabled = config.queryCacheEnabled !== false;
    this.redis = redisClient;
    this.metrics = metrics;
    this.now = now;
    this.defaultTtlMs = config.queryCacheDefaultTtlMs ?? 5000;
    this.volatileTtlMs = config.queryCacheTtlVolatileMs ?? 1000;
    this.stableTtlMs = config.queryCacheTtlStableMs ?? 60_000;
    this.local = new Map();
  }
  key(query, args = []) { return `query:v1:${query}:${JSON.stringify(args)}`; }
  ttl(volatility = 'default') { return volatility === 'volatile' ? this.volatileTtlMs : volatility === 'stable' ? this.stableTtlMs : this.defaultTtlMs; }
  async get(query, args = []) {
    if (!this.enabled) return null;
    const started = this.now();
    const record = (outcome) => this.metrics?.observeQueryCache?.(outcome, (this.now() - started) / 1000);
    const key = this.key(query, args);
    const local = this.local.get(key);
    if (local && local.expiresAt > this.now()) { record('hit'); return local.value; }
    this.local.delete(key);
    if (this.redis) {
      try { const raw = await this.redis.get(key); if (raw !== null) { const value = JSON.parse(raw); record('hit'); return value; } } catch { record('error'); return null; }
    }
    record('miss');
    return null;
  }
  async set(query, args, value, volatility = 'default') {
    if (!this.enabled) return;
    const key = this.key(query, args); const ttlMs = this.ttl(volatility);
    this.local.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.redis) { try { await this.redis.set(key, JSON.stringify(value), Math.ceil(ttlMs / 1000)); } catch { this.metrics?.observeQueryCache?.('error'); } }
  }
  async invalidate(query, args = []) {
    const key = this.key(query, args); this.local.delete(key);
    if (this.redis) { try { await this.redis.del(key); } catch { this.metrics?.observeQueryCache?.('error'); } }
  }
  async warm(entries, resolver) {
    for (const entry of entries ?? []) {
      const query = typeof entry === 'string' ? entry : entry.query;
      const args = typeof entry === 'string' ? [] : (entry.args ?? []);
      const value = await resolver(query, args);
      if (value !== null && value !== undefined) await this.set(query, args, value, typeof entry === 'string' ? 'stable' : entry.volatility);
    }
  }
}
