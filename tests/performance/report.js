#!/usr/bin/env node
/**
 * Performance comparison report generator (#880).
 *
 * Reads the results written by the test suite (api-performance.test.js and
 * contract-gas.test.js) and produces a Markdown report comparing measured
 * results against the baselines in baselines.json.
 *
 * Usage:
 *   node tests/performance/report.js [--output report.md] [--results results.json]
 *
 * Flags:
 *   --output <path>    Write Markdown report to this file (default: stdout)
 *   --results <path>   JSON file with measured results (default: perf-results.json)
 *   --update           Overwrite baselines.json with measured values (+10% headroom)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};

const OUTPUT_PATH   = flag("--output");
const RESULTS_PATH  = flag("--results")  ?? path.join(__dirname, "perf-results.json");
const UPDATE        = args.includes("--update");
const BASELINES_PATH = path.join(__dirname, "baselines.json");

const baselines = JSON.parse(readFileSync(BASELINES_PATH, "utf8"));

if (!existsSync(RESULTS_PATH)) {
  console.error(
    `Results file not found: ${RESULTS_PATH}\n` +
    `Run the performance test suite first:\n` +
    `  bash tests/performance/run.sh`,
  );
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
const REGRESSION_PCT = results._regressionPct ?? 10;
const now = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(measured, base) {
  if (!base) return "N/A";
  const delta = ((measured - base) / base) * 100;
  return delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
}

function status(measured, base) {
  if (!base) return "⬜";
  const delta = ((measured - base) / base) * 100;
  if (delta > REGRESSION_PCT) return "🔴";
  if (delta > REGRESSION_PCT / 2) return "🟡";
  return "🟢";
}

// ── Build report ──────────────────────────────────────────────────────────────

const lines = [
  `# Performance Regression Report`,
  ``,
  `Generated: ${now}  `,
  `Regression threshold: **${REGRESSION_PCT}%**`,
  ``,
  `## API Endpoint Latency`,
  ``,
  `| Status | Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | vs baseline p95 |`,
  `| :-: | :-- | --: | --: | --: | --: |`,
];

for (const [label, baseline] of Object.entries(baselines.api)) {
  const m = results.api?.[label];
  if (!m) {
    lines.push(`| ⬜ | ${label} | — | — | — | no data |`);
    continue;
  }
  const s = status(m.p95, baseline.p95_ms);
  const change = pct(m.p95, baseline.p95_ms);
  lines.push(
    `| ${s} | \`${label}\` | ${m.p50.toFixed(1)} | ${m.p95.toFixed(1)} | ${m.p99.toFixed(1)} | ${change} |`,
  );
}

lines.push(``, `## Contract Gas Usage`, ``);
lines.push(`| Status | Operation | cpu_insns | mem_bytes | cpu vs baseline | mem vs baseline |`);
lines.push(`| :-: | :-- | --: | --: | --: | --: |`);

for (const [op, baseline] of Object.entries(baselines.contract)) {
  const m = results.contract?.[op];
  if (!m) {
    lines.push(`| ⬜ | ${op} | — | — | no data | no data |`);
    continue;
  }
  const sCpu = status(m.cpu_insns, baseline.cpu_insns_max);
  const sMem = status(m.mem_bytes, baseline.mem_bytes_max);
  const overall = (sCpu === "🔴" || sMem === "🔴") ? "🔴" : (sCpu === "🟡" || sMem === "🟡") ? "🟡" : "🟢";
  lines.push(
    `| ${overall} | \`${op}\` | ${m.cpu_insns} | ${m.mem_bytes} | ${pct(m.cpu_insns, baseline.cpu_insns_max)} | ${pct(m.mem_bytes, baseline.mem_bytes_max)} |`,
  );
}

lines.push(``, `---`, ``, `🟢 OK  🟡 Warning (>50% of threshold)  🔴 Regression (>${REGRESSION_PCT}%)  ⬜ No data`);

const report = lines.join("\n") + "\n";

if (OUTPUT_PATH) {
  writeFileSync(OUTPUT_PATH, report);
  console.log(`Report written to ${OUTPUT_PATH}`);
} else {
  process.stdout.write(report);
}

// ── Baseline update ───────────────────────────────────────────────────────────

if (UPDATE) {
  if (results.api) {
    for (const [label, m] of Object.entries(results.api)) {
      baselines.api[label] = {
        p50_ms: Math.ceil(m.p50 * 1.1),
        p95_ms: Math.ceil(m.p95 * 1.1),
        p99_ms: Math.ceil(m.p99 * 1.1),
      };
    }
  }
  if (results.contract) {
    for (const [op, m] of Object.entries(results.contract)) {
      baselines.contract[op] = {
        cpu_insns_max: Math.ceil(m.cpu_insns * 1.1),
        mem_bytes_max: Math.ceil(m.mem_bytes * 1.1),
      };
    }
  }
  writeFileSync(BASELINES_PATH, JSON.stringify(baselines, null, 2) + "\n");
  console.error("Baselines updated:", BASELINES_PATH);
}
