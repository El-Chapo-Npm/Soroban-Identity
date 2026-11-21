import http from 'node:http';
import { loadConfig, validateConfig, logDefaultValues } from './config.js';
import { createApp } from './app.js';
import { ensureDataDir } from './storage.js';
import { ExpiryNotificationJob } from './expiry.js';
import { MetricsAggregator, MetricsService } from './metrics.js';
import { AnalyticsService } from './analytics.js';
import { SorobanClient } from './soroban.js';
import { logger } from './logger.js';
import { DidCache } from './did-cache.js';
import { WebhookDeliveryService } from './webhooks.js';
import { ApiKeyService } from './api-keys.js';
import { WebSocketHub } from './websocket.js';
import { RotatingFileSink } from './access-log.js';
import { VaultLeaseManager } from './vault.js';
import { initFeatureFlags, getFlag } from './feature-flags.js';
import { QueryResultCache } from './query-cache.js';
import { DdosProtection } from './ddos-protection.js';
import { createBatchVerificationQueue, createCredentialIssueQueue } from './job-queue.js';
import { createIdentityRouter } from './identity-routes.js';

// Load secrets before validation so existing config consumers see the same
// values as environment-backed deployments. Vault is opt-in and fails closed
// when explicitly configured rather than silently falling back to plaintext.
const secretsManager = new VaultLeaseManager();
if (secretsManager.enabled) {
  try {
    await secretsManager.refresh();
  } catch (error) {
    logger.error({ error: error.message }, 'Secret vault initialization failed');
    process.exit(1);
  }
}

const validationResult = validateConfig();
if (!validationResult.isValid) {
  if (validationResult.missing.length > 0) {
    console.error('[config] Missing required environment variables:');
    for (const err of validationResult.missing) {
      console.error(`[config] ${err}`);
    }
  }
  if (validationResult.invalid.length > 0) {
    console.error('[config] Invalid environment variables:');
    for (const err of validationResult.invalid) {
      console.error(`[config] ${err}`);
    }
  }
  process.exit(1);
}

logDefaultValues();

const config = loadConfig();
if (secretsManager.enabled) {
  secretsManager.onSecrets = async () => {
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
const analytics = new AnalyticsService();
const didCache = new DidCache(config, { metrics });
// Connecting never throws: a cache outage must not stop the server booting.
await didCache.connect();
const queryCache = new QueryResultCache(config, { redisClient: didCache.client, metrics });
const ddosProtection = new DdosProtection(config, {
  onAlert: async (event) => {
    metrics.observeDdosEvent(event.type);
    logger.warn(event, 'DDoS protection event');
  },
});
const soroban = new SorobanClient(config, metrics, { didCache, queryCache });
if (config.queryCacheWarmQueries.length > 0) {
  void queryCache.warm(config.queryCacheWarmQueries, async (query) => {
    if (query === 'get_issuers') return soroban.getIssuers();
    return null;
  }).catch((error) => logger.warn({ error: error.message }, 'Query cache warm failed'));
}
if (config.didCacheWarmList.length > 0) {
  void didCache
    .warm(config.didCacheWarmList, (did) => soroban.resolveDid(did))
    .catch((error) => logger.error({ error: error.message }, 'DID cache warm failed'));
}
const webhookService = new WebhookDeliveryService(config);
const metricsAggregator = new MetricsAggregator(soroban, metrics, {
  startLedger: Number.parseInt(process.env.METRICS_START_LEDGER ?? '0', 10),
});
const expiryJob = new ExpiryNotificationJob(config, soroban);
if (process.env.DISABLE_EXPIRY_JOB !== 'true') expiryJob.start();
const apiKeyService = new ApiKeyService(config);

// Initialize job queues for async processing (#716)
let credentialIssueQueue = null;
let batchVerificationQueue = null;

if (config.jobQueueEnabled && config.redisUrl) {
  try {
    credentialIssueQueue = createCredentialIssueQueue(didCache.client, {
      metrics,
      maxRetries: config.jobQueueMaxRetries,
      retryBackoffMs: config.jobQueueRetryBackoffMs,
      processingTimeoutMs: config.jobQueueProcessingTimeoutMs,
    });

    batchVerificationQueue = createBatchVerificationQueue(didCache.client, {
      metrics,
      maxRetries: config.jobQueueMaxRetries,
      retryBackoffMs: config.jobQueueRetryBackoffMs,
      processingTimeoutMs: config.jobQueueProcessingTimeoutMs,
    });

    logger.info('Job queues initialized for async credential processing');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize job queues');
  }
}

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

// Identity and attestation REST endpoints (#1273-#1276). The router is built
// with the same shared services as the rest of the app so authentication,
// rate limiting, access logging, metrics and error handling behave uniformly.
const identityRouter = createIdentityRouter({
  config,
  soroban,
  metrics,
  didCache,
  apiKeyService,
  webhookService,
  realtime,
});

let dbPool = null;
if (config.databaseUrl) {
  const { default: pg } = await import('pg');
  dbPool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
}

const server = http.createServer(
  createApp({
    config,
    soroban,
    dbClient: dbPool,
    metrics,
    metricsAggregator,
    didCache,
    credentialIssueQueue,
    batchVerificationQueue,
    webhookService,
    apiKeyService,
    accessLogSink,
    realtime,
    ddosProtection,
    identityRouter,
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
  logger.info({ port: config.port }, `Soroban Identity server listening on :${config.port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down gracefully');

  // Stop accepting new requests
  server.close(async () => {
    try {
      // Stop job processing (#716)
      if (credentialIssueQueue) {
        logger.info('Stopping credential issuance queue');
        await credentialIssueQueue.stop();
      }
      if (batchVerificationQueue) {
        logger.info('Stopping batch verification queue');
        await batchVerificationQueue.stop();
      }

      // Stop expiry job
      if (process.env.DISABLE_EXPIRY_JOB !== 'true') {
        expiryJob.stop();
      }

      // Stop vault manager
      secretsManager.stop();

      // Close WebSocket hub
      if (realtime) {
        logger.info('Closing WebSocket connections');
        await realtime.close();
      }

      // Drain services
      logger.info('Draining webhook service');
      webhookService.drain();

      logger.info('Draining Soroban client');
      await soroban.drain();

      if (dbPool) {
        logger.info('Closing database pool');
        await dbPool.end();
      }

      // Close access log sink
      if (accessLogSink) {
        logger.info('Closing access log sink');
        await accessLogSink.close();
      }

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error during graceful shutdown');
      process.exit(1);
    }
  });

  // Set shutdown timeout to force exit if graceful shutdown takes too long (#722)
  const timeoutMs = config.shutdownTimeoutMs ?? 30000;
  const timer = setTimeout(() => {
    logger.warn({ timeoutMs }, 'Graceful shutdown timeout exceeded, forcing exit');
    // Destroy all active connections
    for (const socket of connections) {
      socket.destroy();
    }
    process.exit(1);
  }, timeoutMs);
  timer.unref();

  // Don't wait for lingering connections
  server.closeAllConnections?.();
}

// Register signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
