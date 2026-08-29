#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2] ?? 'data/access.log';
const thresholdMs = Number(process.env.SLOW_QUERY_MS ?? 250);
const aggregate = new Map();
if (!fs.existsSync(file)) {
  console.error(`Access log not found: ${file}`);
  process.exit(1);
}
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    const route = row.route ?? row.path ?? 'unknown';
    const durationMs = Number(row.durationMs ?? (Number(row.durationSeconds) * 1000));
    const entry = aggregate.get(route) ?? { route, count: 0, slow: 0, totalMs: 0, maxMs: 0 };
    entry.count += 1;
    entry.totalMs += Number.isFinite(durationMs) ? durationMs : 0;
    entry.maxMs = Math.max(entry.maxMs, durationMs || 0);
    if (durationMs >= thresholdMs) entry.slow += 1;
    aggregate.set(route, entry);
  } catch { /* ignore non-JSON access lines */ }
}
const results = [...aggregate.values()].map((entry) => ({ ...entry, avgMs: Number((entry.totalMs / entry.count).toFixed(2)) })).sort((a, b) => (b.slow - a.slow) || (b.avgMs - a.avgMs));
console.log(JSON.stringify({ thresholdMs, generatedAt: new Date().toISOString(), hotQueries: results.slice(0, 50) }, null, 2));
