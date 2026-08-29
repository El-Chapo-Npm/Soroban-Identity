import http from 'node:http';
import { loadConfig, validateConfig, logDefaultValues } from './config.js';
import { createApp } from './app.js';
import { ensureDataDir } from './storage.js';
import { ExpiryNotificationJob } from './expiry.js';
import { MetricsAggregator, MetricsService } from './metrics.js';
import { SorobanClient } from './soroban.js';
import { DidCache } from './did-cache.js';
import { WebhookDeliveryService } from './webhooks.js';
import { ApiKeyService } from './api-keys.js';
import { WebSocketHub } from './websocket.js';
import { logger } from './logger.js';
import { RotatingFileSink } from './access-log.js';
import { VaultLeaseManager } from './vault.js';
import { initFeatureFlags, getFlag } from './feature-flags.js';

// Load secrets before validation so existing config consumers see the same
// values as environment-backed deployments. Vault is opt-in and fails closed
// when explicitly configured rather than silently falling back to plaintext.
const vaultManager = new VaultLeaseManager();
if (vaultManager.enabled) {
  try {
    await vaultManager.refresh();
  } catch (error) {
    logger.error({ error: error.message }, 'Vault initialization failed');
    process.exit(1);
  }
}

const validationResult = validateConfig();
if (!validationResult.isValid) {
  if (validationResult.missing.length > 0) {
    logger.error({ missing: validationResult.missing }, 'Missing required environment variables');
    for (const err of validationResult.missing) {
      logger.error(`  - ${err}`);
    }
  }
  if (validationResult.invalid.length > 0) {
    logger.error({ invalid: validationResult.invalid }, 'Invalid environment variables');
    for (const err of validationResult.invalid) {
      logger.error(`  - ${err}`);
    }
  }
  process.exit(1);
}

logDefaultValues();

const config = loadConfig();
if (vaultManager.enabled) {
  vaultManager.onSecrets = async () => {
    Object.assign(config, loadConfig());
    logger.info('Vault secrets applied to live configuration');
  };
}
await ensureDataDir(config);
// Initialize the feature flag system (#723) and seed a default flag for new
// credential types so downstream modules can roll them out gradually.
await initFeatureFlags(config.dataDir);
if (!getFlag('new_credential_types')) {
  const { createFlag } = await import('./feature-flags.js');
  await createFlag(config.dataDir, {
    key: 'new_credential_types',
    description: 'Enable newly introduced verifiable credential types',
    type: 'variant',
    defaultValue: 'disabled',
    targetingRules: [
      { attribute: 'tier', operator: 'eq', value: 'enterprise', variant: 'enabled' },
    ],
    createdBy: config.adminActor ?? 'admin',
  });
}
const metrics = new MetricsService();
const didCache = new DidCache(config, { metrics });
const queryCache = new QueryResultCache(config, { redisClient: didCache.client, metrics });
const ddosProtection = new DdosProtection(config, { onAlert: async (event) => { metrics.observeDdosEvent(event.type); logger.warn(event, 'DDoS protection event'); } });
// Connecting never throws: a cache outage must not stop the server booting.
await didCache.connect();
const soroban = new SorobanClient(config, metrics, { didCache, queryCache });
if (config.queryCacheWarmQueries.length > 0) {
  void queryCache.warm(config.queryCacheWarmQueries, async (query) => {
    if (query === 'get_issuers') return soroban.getIssuers();
    return null;
  }).catch((error) => logger.warn({ error: error.message }, 'Query cache warm failed'));
}

if (config.didCacheWarmList.length > 0) {
  // Warm in the background so startup is not blocked on RPC round trips.
  void didCache
    .warm(config.didCacheWarmList, (did) => soroban.resolveDid(did))
    .catch((error) => logger.error({ error: error.message }, 'DID cache warm failed'));
}
const webhookService = new WebhookDeliveryService(config);
const metricsAggregator = new MetricsAggregator(soroban, metrics, { startLedger: Number.parseInt(process.env.METRICS_START_LEDGER ?? '0', 10) });
const expiryJob = new ExpiryNotificationJob(config, soroban);

if (process.env.DISABLE_EXPIRY_JOB !== 'true') expiryJob.start();

const apiKeyService = new ApiKeyService(config);

// The hub is created before the app so credential and DID changes can be
// pushed to subscribers from the same handlers that fire webhooks.
const realtime = config.wsEnabled
  ? new WebSocketHub({
      config,
      soroban,
      apiKeyService,
      heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
    })
  : null;

let accessLogSink = null;
if (config.accessLogEnabled && config.accessLogPath) {
  accessLogSink = new RotatingFileSink({
    filePath: config.accessLogPath,
    maxBytes: config.accessLogMaxBytes,
    maxFiles: config.accessLogMaxFiles,
  });
  // A file sink that cannot be opened falls back to stdout-only logging
  // rather than preventing the server from starting.
  await accessLogSink.open().catch((error) => {
    logger.error({ error: error.message, path: config.accessLogPath }, 'Access log file unavailable; logging to stdout only');
    accessLogSink = null;
  });
}

const server = http.createServer(
  createApp({
    config,
    soroban,
    metrics,
    metricsAggregator,
    didCache,
    webhookService,
    apiKeyService,
    accessLogSink,
    realtime,
    ddosProtection,
  }),
);

if (realtime) {
  realtime.attach(server);
  logger.info({ path: config.wsPath }, 'WebSocket endpoint enabled');
}


const connections = new Set();
server.on('connection', (socket) => {
  const ip = config.trustProxy ? (socket.remoteAddress ?? 'unknown') : (socket.remoteAddress ?? 'unknown');
  if (!ddosProtection.connectionOpened(ip)) {
    socket.destroy();
    return;
  }
  connections.add(socket);
  socket.on('close', () => {
    connections.delete(socket);
    ddosProtection.connectionClosed(ip);
  });
});

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'Soroban Identity server listening');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  if (process.env.DISABLE_EXPIRY_JOB !== 'true') {
    expiryJob.stop();
  }
  vaultManager.stop();

  const timeoutMs = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '10000', 10);
  const timer = setTimeout(() => {
    logger.warn({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
    for (const socket of connections) {
      socket.destroy();
    }
    process.exit(1);
  }, timeoutMs);
  timer.unref();

  server.close(async () => {
    clearTimeout(timer);
    try {
      if (realtime) await realtime.close();
      webhookService.drain();
      await soroban.drain();
      if (accessLogSink) await accessLogSink.close();
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error during drain');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
