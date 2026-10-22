/**
 * Time-series metrics storage (issue #1112).
 *
 * `TimeSeriesStore` is an in-memory implementation with the same semantics as
 * the TimescaleDB schema in `server/migrations/001_timeseries.sql`:
 *   - raw points kept for `rawRetentionMs`, then downsampled into rollup buckets
 *   - rollups kept for `rollupRetentionMs`, then dropped
 *   - continuous aggregates (count/sum/min/max/avg/p95) over fixed buckets
 * `TimescaleStore` issues equivalent SQL against a `pg`-compatible client.
 */

export const METRICS = Object.freeze({
  API_LATENCY: 'api_request_latency_ms',
  CREDENTIAL_OPS: 'credential_operations',
  ERRORS: 'errors',
  RESOURCE_CPU: 'resource_cpu_percent',
  RESOURCE_MEM: 'resource_memory_bytes',
  KPI: 'business_kpi',
});

const DAY = 86_400_000;

function tagKey(tags = {}) {
  return Object.keys(tags).sort().map((k) => `${k}=${tags[k]}`).join(',');
}

function matches(tags, filter) {
  return Object.entries(filter ?? {}).every(([k, v]) => tags[k] === v);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function aggregate(values) {
  if (!values.length) return { count: 0, sum: 0, min: null, max: null, avg: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    sum,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p95: percentile(sorted, 95),
  };
}

export class TimeSeriesStore {
  #raw = new Map(); // metric -> [{ts, value, tags, key}]
  #rollups = new Map(); // metric -> Map(bucketTs|tagKey -> agg)

  constructor({ rawRetentionMs = 7 * DAY, rollupRetentionMs = 365 * DAY, rollupBucketMs = 3_600_000 } = {}) {
    this.rawRetentionMs = rawRetentionMs;
    this.rollupRetentionMs = rollupRetentionMs;
    this.rollupBucketMs = rollupBucketMs;
  }

  write(metric, value, tags = {}, ts = Date.now()) {
    if (!Number.isFinite(value)) throw new TypeError('value must be a finite number');
    if (!this.#raw.has(metric)) this.#raw.set(metric, []);
    const series = this.#raw.get(metric);
    const point = { ts, value, tags, key: tagKey(tags) };
    // Keep series ordered by time; appends are the common case.
    if (!series.length || series[series.length - 1].ts <= ts) series.push(point);
    else series.splice(series.findIndex((p) => p.ts > ts), 0, point);
  }

  /** Raw points in [from, to). */
  range(metric, { from = 0, to = Infinity, tags } = {}) {
    return (this.#raw.get(metric) ?? []).filter((p) => p.ts >= from && p.ts < to && matches(p.tags, tags));
  }

  /**
   * Real-time aggregation into fixed buckets (like `time_bucket`). Falls back
   * to rollups for ranges older than raw retention.
   */
  query(metric, { from = 0, to = Date.now(), bucketMs = 60_000, tags, groupBy } = {}) {
    const groups = new Map();
    const add = (bucket, group, values, agg) => {
      const k = `${bucket}|${group}`;
      if (!groups.has(k)) groups.set(k, { bucket, group, values: [], aggs: [] });
      const g = groups.get(k);
      if (values) g.values.push(...values);
      if (agg) g.aggs.push(agg);
    };
    for (const p of this.range(metric, { from, to, tags })) {
      add(Math.floor(p.ts / bucketMs) * bucketMs, groupBy ? p.tags[groupBy] ?? null : null, [p.value]);
    }
    const rawFloor = this.#oldestRaw(metric);
    for (const r of this.#rollups.get(metric)?.values() ?? []) {
      if (r.bucket < from || r.bucket >= to || r.bucket >= rawFloor || !matches(r.tags, tags)) continue;
      add(Math.floor(r.bucket / bucketMs) * bucketMs, groupBy ? r.tags[groupBy] ?? null : null, null, r);
    }
    return [...groups.values()]
      .map(({ bucket, group, values, aggs }) => {
        const a = aggregate(values);
        for (const r of aggs) {
          a.count += r.count;
          a.sum += r.sum;
          a.min = a.min === null ? r.min : Math.min(a.min, r.min);
          a.max = a.max === null ? r.max : Math.max(a.max, r.max);
          a.p95 = a.p95 === null ? r.p95 : Math.max(a.p95, r.p95);
        }
        a.avg = a.count ? a.sum / a.count : null;
        return { bucket, ...(groupBy ? { [groupBy]: group } : {}), ...a };
      })
      .sort((x, y) => x.bucket - y.bucket);
  }

  /** Per-second rate of a counter-style metric over a window. */
  rate(metric, { windowMs = 60_000, now = Date.now(), tags } = {}) {
    const pts = this.range(metric, { from: now - windowMs, to: now + 1, tags });
    return pts.reduce((s, p) => s + p.value, 0) / (windowMs / 1000);
  }

  /** Error rate = errors / requests over a window. */
  errorRate({ windowMs = 300_000, now = Date.now() } = {}) {
    const reqs = this.range(METRICS.API_LATENCY, { from: now - windowMs, to: now + 1 }).length;
    const errs = this.range(METRICS.ERRORS, { from: now - windowMs, to: now + 1 }).reduce((s, p) => s + p.value, 0);
    return reqs ? errs / reqs : 0;
  }

  /**
   * Apply retention policies: downsample raw points older than raw retention
   * into hourly rollups, and drop rollups older than rollup retention.
   */
  compact(now = Date.now()) {
    let downsampled = 0;
    let dropped = 0;
    for (const [metric, series] of this.#raw) {
      const cutoff = now - this.rawRetentionMs;
      let i = 0;
      while (i < series.length && series[i].ts < cutoff) i++;
      const old = series.splice(0, i);
      if (!this.#rollups.has(metric)) this.#rollups.set(metric, new Map());
      const rollups = this.#rollups.get(metric);
      const buckets = new Map();
      for (const p of old) {
        const bucket = Math.floor(p.ts / this.rollupBucketMs) * this.rollupBucketMs;
        const k = `${bucket}|${p.key}`;
        if (!buckets.has(k)) buckets.set(k, { bucket, tags: p.tags, values: [] });
        buckets.get(k).values.push(p.value);
      }
      for (const [k, b] of buckets) {
        const prev = rollups.get(k);
        const a = aggregate(b.values);
        rollups.set(k, prev
          ? { ...prev, count: prev.count + a.count, sum: prev.sum + a.sum, min: Math.min(prev.min, a.min), max: Math.max(prev.max, a.max), p95: Math.max(prev.p95, a.p95) }
          : { bucket: b.bucket, tags: b.tags, ...a });
      }
      downsampled += old.length;
      for (const [k, r] of rollups) {
        if (r.bucket < now - this.rollupRetentionMs) { rollups.delete(k); dropped++; }
      }
    }
    return { downsampled, dropped };
  }

  /** Data for the metrics dashboard. */
  dashboard({ now = Date.now(), windowMs = 3_600_000, bucketMs = 60_000 } = {}) {
    const q = (m, extra) => this.query(m, { from: now - windowMs, to: now + 1, bucketMs, ...extra });
    return {
      generatedAt: new Date(now).toISOString(),
      latency: q(METRICS.API_LATENCY),
      credentialOpsPerSecond: this.rate(METRICS.CREDENTIAL_OPS, { now }),
      errorRate: this.errorRate({ now }),
      cpu: q(METRICS.RESOURCE_CPU),
      memory: q(METRICS.RESOURCE_MEM),
      kpis: q(METRICS.KPI, { groupBy: 'name' }),
    };
  }

  #oldestRaw(metric) {
    return this.#raw.get(metric)?.[0]?.ts ?? Infinity;
  }
}

/** TimescaleDB-backed store. `client` must expose `query(text, params)`. */
export class TimescaleStore {
  constructor(client) {
    this.client = client;
  }

  write(metric, value, tags = {}, ts = Date.now()) {
    return this.client.query(
      'INSERT INTO metrics (time, metric, value, tags) VALUES (to_timestamp($1 / 1000.0), $2, $3, $4)',
      [ts, metric, value, tags],
    );
  }

  async query(metric, { from, to, bucketMs = 60_000, tags = {} } = {}) {
    const { rows } = await this.client.query(
      `SELECT time_bucket(make_interval(secs => $1 / 1000.0), time) AS bucket,
              count(*) AS count, sum(value) AS sum, min(value) AS min, max(value) AS max, avg(value) AS avg,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95
         FROM metrics
        WHERE metric = $2 AND time >= to_timestamp($3 / 1000.0) AND time < to_timestamp($4 / 1000.0)
          AND tags @> $5
        GROUP BY bucket ORDER BY bucket`,
      [bucketMs, metric, from, to, tags],
    );
    return rows;
  }
}

/** Route handler for `GET /metrics/timeseries/dashboard` and `/metrics/timeseries/query`. */
export function handleTimeSeriesRoutes(req, res, url, store) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') return false;
  if (url.pathname === '/metrics/timeseries/dashboard') {
    send(200, store.dashboard());
    return true;
  }
  if (url.pathname === '/metrics/timeseries/query') {
    const metric = url.searchParams.get('metric');
    if (!metric) { send(400, { error: 'metric is required' }); return true; }
    const num = (k, d) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : d);
    send(200, {
      metric,
      points: store.query(metric, {
        from: num('from', Date.now() - 3_600_000),
        to: num('to', Date.now()),
        bucketMs: num('bucketMs', 60_000),
        groupBy: url.searchParams.get('groupBy') ?? undefined,
      }),
    });
    return true;
  }
  return false;
}
