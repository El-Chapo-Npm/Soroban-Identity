// Runs chaos experiments against the API server and reports resilience metrics.
// Usage: node run-chaos.mjs [scenario...]   (defaults to all)
import { readdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { setup, reset } from "./toxiproxy.mjs";

const API = process.env.CHAOS_API_URL ?? "http://localhost:3002";
const HEALTH = `${API}/health`;

/** Samples the API for `ms` milliseconds; returns success rate and latency stats (blast radius). */
export async function probe(ms = 5000, path = "/health") {
  const results = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const start = performance.now();
    try {
      const res = await fetch(API + path, { signal: AbortSignal.timeout(3000) });
      results.push({ ok: res.status < 500, status: res.status, ms: performance.now() - start });
    } catch {
      results.push({ ok: false, status: 0, ms: performance.now() - start });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  return {
    requests: results.length,
    successRate: results.filter((r) => r.ok).length / Math.max(results.length, 1),
    p50: lat[Math.floor(lat.length * 0.5)] ?? 0,
    p95: lat[Math.floor(lat.length * 0.95)] ?? 0,
    statuses: [...new Set(results.map((r) => r.status))],
  };
}

/** Waits until the API is healthy again; returns recovery time in ms. */
export async function waitForRecovery(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return Date.now() - start;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return Infinity;
}

const dir = new URL("./scenarios/", import.meta.url);
const selected = process.argv.slice(2);
const files = (await readdir(dir)).filter((f) => f.endsWith(".mjs") && (!selected.length || selected.some((s) => f.includes(s))));

await setup();
const report = [];
let failed = false;
for (const file of files.sort()) {
  const scenario = (await import(new URL(file, dir))).default;
  await reset();
  const baseline = await probe(2000);
  let during, recoveryMs, error;
  try {
    during = await scenario.inject({ probe });
  } catch (e) {
    error = e.message;
  } finally {
    await scenario.restore?.();
    await reset();
    recoveryMs = await waitForRecovery();
  }
  const verdict = scenario.verify({ baseline, during, recoveryMs, error });
  failed ||= !verdict.pass;
  report.push({ name: scenario.name, target: scenario.target, baseline, during, recoveryMs, ...verdict });
  console.log(`${verdict.pass ? "PASS" : "FAIL"} ${scenario.name}: ${verdict.reason}`);
}
writeFileSync(new URL("./chaos-report.json", import.meta.url), JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
