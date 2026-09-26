#!/usr/bin/env node
/**
 * Compare two API benchmark result files and fail if p95 regresses by more than the threshold.
 * Usage: node benches/api/compare.mjs baseline.json current.json [--threshold 10]
 */
import fs from "node:fs";

const [basePath, curPath] = process.argv.slice(2);
const tIdx = process.argv.indexOf("--threshold");
const THRESHOLD = tIdx > 0 ? Number(process.argv[tIdx + 1]) : 10;
const base = Object.fromEntries(JSON.parse(fs.readFileSync(basePath, "utf8")).results.map((r) => [r.name, r]));
const cur = JSON.parse(fs.readFileSync(curPath, "utf8")).results;

let failed = false;
console.log("| endpoint | base p95 (ms) | current p95 (ms) | change |\n|---|---|---|---|");
for (const r of cur) {
  const b = base[r.name];
  if (!b) continue;
  const delta = ((r.p95_ms - b.p95_ms) / b.p95_ms) * 100;
  const flag = delta > THRESHOLD ? " ❌" : "";
  if (delta > THRESHOLD) failed = true;
  console.log(`| ${r.name} | ${b.p95_ms} | ${r.p95_ms} | ${delta.toFixed(1)}%${flag} |`);
}
if (failed) {
  console.error(`\nPerformance regressed by more than ${THRESHOLD}%`);
  process.exit(1);
}
