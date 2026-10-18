import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { correlationHeaders } from './middleware/tracing.js';

/**
 * Process start time, captured once at module load so uptime is measured from
 * when the server booted rather than when the first probe arrived.
 */
const STARTED_AT = Date.now();

const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/**
 * Dependency health states, ordered from healthiest to least healthy.
 *
 * - `up`       — the dependency answered successfully
 * - `degraded` — the dependency answered, but not fully (partial contract set)
 * - `down`     — the dependency failed or timed out
 * - `disabled` — the dependency is not configured, so it is not a failure
 */
export const STATUS = {
  UP: 'up',
  DEGRADED: 'degraded',
  DOWN: 'down',
  DISABLED: 'disabled',
};

/**
 * Race a probe against a timeout so one hung dependency cannot stall the whole
 * health check. The timer is unref'd so it never holds the process open.
 */
async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} probe timed out after ${timeoutMs}ms`)), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one dependency probe, recording its latency and turning any throw into a
 * `down` result. A probe never rejects, so one failing dependency cannot
 * prevent the others from being reported.
 */
async function runProbe(name, timeoutMs, probe) {
  const startTime = Date.now();
  try {
    const result = await withTimeout(probe(), timeoutMs, name);
    return { name, latencyMs: Date.now() - startTime, ...result };
  } catch (error) {
    logger.warn({ dependency: name, error: error.message }, 'Health probe failed');
    return {
      name,
      status: STATUS.DOWN,
      latencyMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Probe the local data store: the directory must exist and be writable, since
 * every credential write goes through it.
 */
export async function checkStorage(config, { fsImpl = fs } = {}) {
  const probeFile = path.join(config.dataDir, '.health-probe');
  await fsImpl.mkdir(config.dataDir, { recursive: true });
  await fsImpl.writeFile(probeFile, String(Date.now()), 'utf8');
  await fsImpl.unlink(probeFile);
  return { status: STATUS.UP, dataDir: config.dataDir, writable: true };
}

/**
 * Probe the Soroban RPC endpoint with a `getHealth` JSON-RPC call.
 */
export async function checkRpc(config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...correlationHeaders() },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });

  if (!response.ok) {
    throw new Error(`RPC returned HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.error) {
    throw new Error(body.error.message ?? 'RPC returned an error');
  }

  const rpcStatus = body?.result?.status;
  return {
    status: rpcStatus && rpcStatus !== 'healthy' ? STATUS.DEGRADED : STATUS.UP,
    url: config.rpcUrl,
    rpcStatus: rpcStatus ?? 'unknown',
    latestLedger: body?.result?.latestLedger,
  };
}

/**
 * Probe the deployed contracts. A partial response is `degraded` rather than
 * `down`: the service can still answer requests for the reachable contracts.
 */
export async function checkContracts(soroban) {
  const contracts = await soroban.pingAllContracts();
  const values = Object.values(contracts);
  const reachable = values.filter(Boolean).length;

  let status = STATUS.UP;
  if (reachable === 0 && values.length > 0) status = STATUS.DOWN;
  else if (reachable < values.length) status = STATUS.DEGRADED;

  return { status, contracts, reachable, total: values.length };
}

/**
 * Probe Redis when one is configured. An unconfigured cache reports `disabled`
 * rather than `down`, since running without Redis is a supported deployment.
 */
export async function checkRedis(config, redisClient) {
  if (!config.redisUrl || !redisClient) {
    return { status: STATUS.DISABLED, reason: 'REDIS_URL is not configured' };
  }
  const pong = await redisClient.ping();
  return { status: STATUS.UP, url: config.redisUrl, response: pong };
}

/**
 * Probe the append-only event store backing credential lifecycle event
 * sourcing. An unconfigured store reports `disabled` rather than `down`, since
 * event sourcing is an optional deployment mode.
 */
export async function checkEventStore(config, eventStore) {
  if (!config.eventStoreUrl || !eventStore) {
    return { status: STATUS.DISABLED, reason: 'EVENT_STORE_URL is not configured' };
  }

  const result = await eventStore.health();
  const storeStatus = result?.status;
  return {
    status: storeStatus && storeStatus !== 'up' ? STATUS.DEGRADED : STATUS.UP,
    url: config.eventStoreUrl,
    storeStatus: storeStatus ?? 'unknown',
    latestSequence: result?.latestSequence,
    streamCount: result?.streamCount,
  };
}

/**
 * Probe the geo-distributed read replicas. Each replica reports its own lag;
 * a replica that is unreachable or lagging beyond the configured threshold
 * degrades the overall replica status without taking the service down, since
 * reads can still be served by the primary.
 */
export async function checkReadReplicas(config, replicaRegistry) {
  if (!config.readReplicas?.length || !replicaRegistry) {
    return { status: STATUS.DISABLED, reason: 'No read replicas are configured' };
  }

  const maxLagMs = config.replicaMaxLagMs ?? 5000;
  const replicas = await replicaRegistry.health();
  const values = Object.values(replicas);
  const reachable = values.filter((replica) => replica?.reachable).length;
  const lagging = values.filter((replica) => replica?.reachable && (replica.lagMs ?? 0) > maxLagMs);

  let status = STATUS.UP;
  if (reachable === 0 && values.length > 0) status = STATUS.DOWN;
  else if (reachable < values.length || lagging.length > 0) status = STATUS.DEGRADED;

  return {
    status,
    replicas,
    reachable,
    total: values.length,
    maxLagMs,
    lagging: lagging.map((replica) => replica.region),
  };
}

/**
 * Roll dependency results up into one overall status.
 *
 * `disabled` dependencies are ignored. Any `down` dependency makes the service
 * unhealthy; any `degraded` one makes it degraded.
 */
export function aggregateStatus(dependencies) {
  const considered = dependencies.filter((dependency) => dependency.status !== STATUS.DISABLED);
  if (considered.some((dependency) => dependency.status === STATUS.DOWN)) return 'unhealthy';
  if (considered.some((dependency) => dependency.status === STATUS.DEGRADED)) return 'degraded';
  return 'healthy';
}

/**
 * Seconds since the process started, as a whole number.
 */
export function uptimeSeconds(now = Date.now()) {
  return Math.floor((now - STARTED_AT) / 1000);
}

/**
 * Collect the full health report: every dependency probed in parallel, each
 * with its own timeout, plus version and uptime information.
 *
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.soroban
 * @param {object} [deps.redisClient]
 * @param {string} deps.version
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} Health report with a top-level `status`.
 */
export async function collectHealth(
  { config, soroban, redisClient = null, eventStore = null, replicaRegistry = null, version },
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? config.healthProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const results = await Promise.all([
    runProbe('storage', timeoutMs, () => checkStorage(config)),
    runProbe('rpc', timeoutMs, () => checkRpc(config)),
    runProbe('contracts', timeoutMs, () => checkContracts(soroban)),
    runProbe('redis', timeoutMs, () => checkRedis(config, redisClient)),
    runProbe('eventStore', timeoutMs, () => checkEventStore(config, eventStore)),
    runProbe('readReplicas', timeoutMs, () => checkReadReplicas(config, replicaRegistry)),
  ]);

  const dependencies = {};
  for (const { name, ...rest } of results) {
    dependencies[name] = rest;
  }

  return {
    status: aggregateStatus(results),
    version,
    uptimeSeconds: uptimeSeconds(),
    startedAt: new Date(STARTED_AT).toISOString(),
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    dependencies,
  };
}

/**
 * Readiness for a Kubernetes readiness probe.
 *
 * Readiness answers "can this instance serve traffic right now", which is a
 * narrower question than liveness: only the dependencies required to answer a
 * request count. Storage and RPC are required; contracts and Redis are
 * reported but do not gate readiness, since a single unreachable contract or a
 * cold cache still leaves most endpoints serviceable.
 *
 * The event store gates readiness only when event sourcing is enabled, and the
 * read replicas gate readiness only when replicas are configured and every
 * replica is unreachable — a lagging or partially available replica set still
 * serves reads from the primary.
 */
export async function collectReadiness(
  { config, soroban, redisClient = null, eventStore = null, replicaRegistry = null, version },
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? config.healthProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const required = await Promise.all([
    runProbe('storage', timeoutMs, () => checkStorage(config)),
    runProbe('rpc', timeoutMs, () => checkRpc(config)),
  ]);

  const optional = await Promise.all([
    runProbe('eventStore', timeoutMs, () => checkEventStore(config, eventStore)),
    runProbe('readReplicas', timeoutMs, () => checkReadReplicas(config, replicaRegistry)),
  ]);

  const failed = required.filter((dependency) => dependency.status === STATUS.DOWN);
  const gating = optional.filter(
    (dependency) => dependency.status === STATUS.DOWN && dependency.name !== 'readReplicas',
  );
  const allFailed = [...failed, ...gating];

  const checks = {};
  for (const { name, ...rest } of [...required, ...optional]) {
    checks[name] = rest;
  }

  return {
    ready: allFailed.length === 0,
    version,
    uptimeSeconds: uptimeSeconds(),
    timestamp: new Date().toISOString(),
    checks,
    ...(allFailed.length > 0 ? { failing: allFailed.map((dependency) => dependency.name) } : {}),
  };
}

export { STARTED_AT, DEFAULT_PROBE_TIMEOUT_MS };
