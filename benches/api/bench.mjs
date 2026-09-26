#!/usr/bin/env node
/**
 * API endpoint latency benchmarks (#829).
 *
 * Usage: node benches/api/bench.mjs [--base http://localhost:3000] [--n 200] [--out results.json]
 * Records p50/p95/p99 latency plus process memory/heap per endpoint.
 * DB query performance is covered by the endpoints that hit storage (/dids, /credentials).
 */
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const BASE = args.base ?? process.env.BENCH_BASE_URL ?? "http://localhost:3000";
const N = Number(args.n ?? 200);
const OUT = args.out ?? "benches/api/results.json";
const API_KEY = process.env.BENCH_API_KEY;

const ENDPOINTS = [
  { name: "health", path: "/health" },
  { name: "openapi", path: "/openapi.json" },
  { name: "metrics", path: "/metrics" },
  { name: "list_dids", path: "/dids?limit=20" },
  { name: "list_credentials", path: "/credentials?limit=20" },
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function run({ name, path }) {
  const headers = API_KEY ? { "X-API-Key": API_KEY } : {};
  const times = [];
  let errors = 0;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(BASE + path, { headers });
      await r.arrayBuffer();
      if (r.status >= 500) errors++;
    } catch {
      errors++;
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mem = process.memoryUsage();
  return {
    name,
    path,
    samples: N,
    errors,
    p50_ms: +pct(times, 50).toFixed(3),
    p95_ms: +pct(times, 95).toFixed(3),
    p99_ms: +pct(times, 99).toFixed(3),
    mean_ms: +(times.reduce((a, b) => a + b, 0) / N).toFixed(3),
    client_rss_mb: +(mem.rss / 2 ** 20).toFixed(1),
    client_heap_mb: +(mem.heapUsed / 2 ** 20).toFixed(1),
  };
}

const results = [];
for (const ep of ENDPOINTS) {
  const r = await run(ep);
  results.push(r);
  console.log(`${r.name.padEnd(18)} p50=${r.p50_ms}ms p95=${r.p95_ms}ms p99=${r.p99_ms}ms errors=${r.errors}`);
}
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, date: new Date().toISOString(), results }, null, 2));
