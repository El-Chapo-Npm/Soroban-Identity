/**
 * Contract gas regression tests (#880).
 *
 * Parses the budget output written to stdout by `cargo bench -p identity-registry
 * --bench registry` (the `report_budget` function in benches/registry.rs) and
 * fails if any operation exceeds its baseline by more than 10%.
 *
 * Run:
 *   node tests/performance/contract-gas.test.js
 *
 * Typical CI usage (runs Rust benchmarks first, then checks regressions):
 *   bash tests/performance/run.sh
 *
 * Environment variables:
 *   PERF_BENCH_OUTPUT   Path to a file containing cargo bench stdout
 *                       (default: reads from STDIN or looks for bench-output.txt)
 *   PERF_REGRESSION_PCT Max allowed increase in % before failing (default: 10)
 *   PERF_UPDATE_BASELINE  Set to "1" to overwrite baselines.json
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_PATH = path.join(__dirname, "baselines.json");

const MAX_REGRESS  = Number(process.env.PERF_REGRESSION_PCT ?? "10");
const UPDATE_MODE  = process.env.PERF_UPDATE_BASELINE === "1";
const BENCH_OUTPUT = process.env.PERF_BENCH_OUTPUT ?? path.join(__dirname, "bench-output.txt");

const baselines = JSON.parse(readFileSync(BASELINES_PATH, "utf8"));

// ── Parse cargo bench budget lines ───────────────────────────────────────────
// Expected format (from report_budget in benches/registry.rs):
//   [budget] create_did: cpu_insns=1234567 mem_bytes=89012

function parseBenchOutput(text) {
  const results = {};
  for (const line of text.split("\n")) {
    const m = line.match(/\[budget\]\s+(\S+):\s+cpu_insns=(\d+)\s+mem_bytes=(\d+)/);
    if (!m) continue;
    results[m[1]] = {
      cpu_insns: Number(m[2]),
      mem_bytes: Number(m[3]),
    };
  }
  return results;
}

// ── Regression check ──────────────────────────────────────────────────────────

function checkContractRegression(label, measured, baseline) {
  const failures = [];
  for (const [key, base] of Object.entries(baseline)) {
    const actual = measured[key.replace("_max", "")];
    if (actual === undefined) continue;
    const allowed = base * (1 + MAX_REGRESS / 100);
    if (actual > allowed) {
      failures.push(
        `  ${key}: measured ${actual} > baseline ${base} (limit ${Math.ceil(allowed)}, +${MAX_REGRESS}%)`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Contract gas regression for "${label}":\n${failures.join("\n")}`);
  }
}

// ── Load bench output ─────────────────────────────────────────────────────────

let benchResults = {};
let benchAvailable = false;

if (existsSync(BENCH_OUTPUT)) {
  const text = readFileSync(BENCH_OUTPUT, "utf8");
  benchResults = parseBenchOutput(text);
  benchAvailable = Object.keys(benchResults).length > 0;
} else {
  console.warn(
    `[contract-gas] bench output not found at ${BENCH_OUTPUT}.\n` +
    `Run 'cargo bench -p identity-registry --bench registry 2>&1 | tee ${BENCH_OUTPUT}'\n` +
    `then re-run this test to check gas regressions.`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Contract gas regression", () => {
  for (const [op, baseline] of Object.entries(baselines.contract)) {
    it(`${op} is within gas baseline`, { skip: !benchAvailable }, () => {
      const measured = benchResults[op];
      assert.ok(
        measured,
        `No budget data for operation "${op}" in bench output. ` +
        `Ensure report_budget("${op}", ...) is called in benches/registry.rs.`,
      );
      checkContractRegression(op, measured, baseline);

      if (UPDATE_MODE) {
        baselines.contract[op] = {
          cpu_insns_max: Math.ceil(measured.cpu_insns * 1.1),
          mem_bytes_max: Math.ceil(measured.mem_bytes * 1.1),
        };
      }
    });
  }

  it("bench output parses correctly", { skip: !benchAvailable }, () => {
    assert.ok(Object.keys(benchResults).length > 0, "No benchmark results parsed");
    for (const [op, data] of Object.entries(benchResults)) {
      assert.ok(data.cpu_insns >= 0, `${op}: cpu_insns must be non-negative`);
      assert.ok(data.mem_bytes >= 0, `${op}: mem_bytes must be non-negative`);
    }
  });
});

// ── Baseline update ───────────────────────────────────────────────────────────

process.on("exit", () => {
  if (UPDATE_MODE && benchAvailable) {
    writeFileSync(BASELINES_PATH, JSON.stringify(baselines, null, 2) + "\n");
    console.log("Contract gas baselines updated:", BASELINES_PATH);
  }

  if (benchAvailable) {
    console.log("\nContract gas summary:");
    console.log(
      ["Operation", "cpu_insns", "mem_bytes", "cpu baseline", "mem baseline"]
        .map((h) => h.padEnd(24))
        .join(""),
    );
    for (const [op, data] of Object.entries(benchResults)) {
      const b = baselines.contract[op] ?? {};
      console.log(
        [op, data.cpu_insns, data.mem_bytes, b.cpu_insns_max ?? "—", b.mem_bytes_max ?? "—"]
          .map((v) => String(v).padEnd(24))
          .join(""),
      );
    }
  }
});
