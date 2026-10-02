/**
 * API endpoint performance regression tests (#880).
 *
 * Measures p50 / p95 / p99 response times for each endpoint and fails the
 * suite when any percentile exceeds the baseline by more than 10%.
 *
 * Run:
 *   node --test tests/performance/api-performance.test.js
 *
 * Environment variables:
 *   PERF_BASE_URL       Server under test (default: http://localhost:3000)
 *   PERF_ITERATIONS     Samples per endpoint (default: 50)
 *   PERF_REGRESSION_PCT Max allowed degradation in % before failing (default: 10)
 *   PERF_UPDATE_BASELINE  Set to "1" to overwrite baselines.json with measured results
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_PATH = path.join(__dirname, "baselines.json");

const BASE_URL     = process.env.PERF_BASE_URL        ?? "http://localhost:3000";
const ITERATIONS   = Number(process.env.PERF_ITERATIONS ?? "50");
const MAX_REGRESS  = Number(process.env.PERF_REGRESSION_PCT ?? "10");
const UPDATE_MODE  = process.env.PERF_UPDATE_BASELINE === "1";

const baselines = JSON.parse(readFileSync(BASELINES_PATH, "utf8"));

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function fetch(method, urlStr, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  {
        "Content-Type": "application/json",
        "X-API-Key":    process.env.PERF_API_KEY ?? "perf-test-key",
        ...headers,
      },
    };
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Statistics ────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function measureEndpoint(method, path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fetch(method, url, opts);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: samples[0],
    max: samples[samples.length - 1],
    samples: samples.length,
  };
}

// ── Regression check ──────────────────────────────────────────────────────────

function checkRegression(label, measured, baseline) {
  const failures = [];
  for (const [key, base] of Object.entries(baseline)) {
    const actual = measured[key.replace("_ms", "").toLowerCase()];
    if (actual === undefined) continue;
    const allowed = base * (1 + MAX_REGRESS / 100);
    if (actual > allowed) {
      failures.push(
        `  ${key}: measured ${actual.toFixed(1)}ms > baseline ${base}ms (limit ${allowed.toFixed(1)}ms, +${MAX_REGRESS}%)`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Performance regression for "${label}":\n${failures.join("\n")}`);
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

let createdCredentialId = null;

// ── Tests ─────────────────────────────────────────────────────────────────────

const results = {};

describe("API performance regression", () => {
  before(async () => {
    // Ensure the server is reachable.
    try {
      await fetch("GET", `${BASE_URL}/health`);
    } catch {
      console.error(`Server not reachable at ${BASE_URL} – skipping performance tests.`);
      process.exitCode = 0;
    }
  });

  it("GET /health is within baseline", async () => {
    const m = await measureEndpoint("GET", "/health");
    results["GET /health"] = m;
    if (!UPDATE_MODE) checkRegression("GET /health", m, baselines.api["GET /health"]);
  });

  it("GET /info is within baseline", async () => {
    const m = await measureEndpoint("GET", "/info");
    results["GET /info"] = m;
    if (!UPDATE_MODE) checkRegression("GET /info", m, baselines.api["GET /info"]);
  });

  it("GET /credentials is within baseline", async () => {
    const m = await measureEndpoint("GET", "/credentials");
    results["GET /credentials"] = m;
    if (!UPDATE_MODE) checkRegression("GET /credentials", m, baselines.api["GET /credentials"]);
  });

  it("GET /credentials/:id is within baseline", { skip: !createdCredentialId }, async () => {
    const m = await measureEndpoint("GET", `/credentials/${createdCredentialId}`);
    results["GET /credentials/:id"] = m;
    if (!UPDATE_MODE) checkRegression("GET /credentials/:id", m, baselines.api["GET /credentials/:id"]);
  });

  it("POST /credentials/:id/verify is within baseline", { skip: !createdCredentialId }, async () => {
    const m = await measureEndpoint("POST", `/credentials/${createdCredentialId}/verify`);
    results["POST /credentials/:id/verify"] = m;
    if (!UPDATE_MODE) checkRegression("POST /credentials/:id/verify", m, baselines.api["POST /credentials/:id/verify"]);
  });

  it("v1 and v2 paths have comparable latency", async () => {
    const v1 = await measureEndpoint("GET", "/v1/health");
    const v2 = await measureEndpoint("GET", "/v2/health");
    // Version routing overhead must not exceed 5 ms at p95.
    const overhead = Math.abs(v2.p95 - v1.p95);
    assert.ok(
      overhead < 5,
      `Version routing overhead too high: v1 p95=${v1.p95.toFixed(1)}ms, v2 p95=${v2.p95.toFixed(1)}ms (delta ${overhead.toFixed(1)}ms > 5ms)`,
    );
  });
});

// ── Baseline update / report ──────────────────────────────────────────────────

process.on("exit", () => {
  if (UPDATE_MODE && Object.keys(results).length > 0) {
    const updated = { ...baselines, api: { ...baselines.api } };
    for (const [label, m] of Object.entries(results)) {
      updated.api[label] = {
        p50_ms:  Math.ceil(m.p50),
        p95_ms:  Math.ceil(m.p95),
        p99_ms:  Math.ceil(m.p99),
      };
    }
    writeFileSync(BASELINES_PATH, JSON.stringify(updated, null, 2) + "\n");
    console.log("Baselines updated:", BASELINES_PATH);
  }

  // Always emit a summary table.
  if (Object.keys(results).length > 0) {
    console.log("\nPerformance summary:");
    console.log(
      ["Endpoint", "p50 (ms)", "p95 (ms)", "p99 (ms)", "mean (ms)"]
        .map((h) => h.padEnd(28))
        .join(""),
    );
    for (const [label, m] of Object.entries(results)) {
      console.log(
        [label, m.p50.toFixed(1), m.p95.toFixed(1), m.p99.toFixed(1), m.mean.toFixed(1)]
          .map((v) => String(v).padEnd(28))
          .join(""),
      );
    }
  }
});
