#!/usr/bin/env node
/**
 * Container health check for the API server (#883).
 *
 * Exits 0 when the probe endpoint answers with a 2xx status within the
 * timeout, and 1 otherwise (non-2xx, timeout, connection refused). Used by the
 * Dockerfile `HEALTHCHECK` and the docker-compose `healthcheck`, so the image
 * needs no `curl`/`wget`.
 *
 * The default target is the liveness endpoint, `/live`, which never probes a
 * dependency: an RPC or Redis outage must not get a healthy process restarted.
 * Pass `/ready` to gate on dependencies instead.
 *
 * Usage:
 *   node scripts/healthcheck.mjs [path]
 *
 * Environment:
 *   HEALTHCHECK_URL         Full URL to probe; overrides PORT and the path.
 *   PORT                    Server port (default 3001).
 *   HEALTHCHECK_PATH        Path to probe when no argument is given (default /live).
 *   HEALTHCHECK_TIMEOUT_MS  Request timeout in milliseconds (default 3000).
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PATH = '/live';
export const DEFAULT_PORT = '3001';
export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Resolve the URL to probe from the environment and command-line arguments.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string[]} [args] - Command-line arguments after the script name.
 * @returns {string}
 */
export function resolveTarget(env = process.env, args = process.argv.slice(2)) {
  if (env.HEALTHCHECK_URL) return env.HEALTHCHECK_URL;
  const port = env.PORT || DEFAULT_PORT;
  const path = args[0] || env.HEALTHCHECK_PATH || DEFAULT_PATH;
  return `http://127.0.0.1:${port}${path}`;
}

/**
 * Probe `url` once. Never rejects.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export function checkHealth(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let req;
    try {
      req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      });
    } catch (error) {
      // http.get throws synchronously on a malformed URL.
      resolve({ ok: false, error: error.message });
      return;
    }
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', (error) => resolve({ ok: false, error: error.message }));
  });
}

async function main() {
  const url = resolveTarget();
  const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const result = await checkHealth(url, { timeoutMs });
  if (!result.ok) {
    // Docker keeps this output in `docker inspect --format '{{json .State.Health}}'`.
    const reason = result.status ? `HTTP ${result.status}` : result.error;
    console.error(`unhealthy: GET ${url} -> ${reason}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
