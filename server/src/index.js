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
import { createCompressionMiddleware } from './compression.js';
import { createCredentialIssueQueue, createBatchVerificationQueue } from './job-queue.js';

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
const metrics = new MetricsService();
const didCache = new DidCache(config, { metrics });
// Connecting never throws: a cache outage must not stop the server booting.
await didCache.connect();
const soroban = new SorobanClient(config, metrics, { didCache });

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
    credentialIssueQueue,
    batchVerificationQueue,
  }),
);

// Apply response compression middleware (#721)
if (config.compressionEnabled) {
  const compression = createCompressionMiddleware({
    threshold: config.compressionThreshold,
    gzipLevel: config.compressionGzipLevel,
    brotliLevel: config.compressionBrotliLevel,
    enableBrotli: config.compressionEnableBrotli,
    metrics,
  });
  // Note: Compression is applied in app.js via middleware pattern
}

if (realtime) {
  realtime.attach(server);
  logger.info({ path: config.wsPath }, 'WebSocket endpoint enabled');
}


const connections = new Set();
server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => {
    connections.delete(socket);
  });
});

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'Soroban Identity server listening');
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
      vaultManager.stop();

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

const connections = new Set();
server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => {
    connections.delete(socket);
  });
});

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'Soroban Identity server listening');
});

// Register signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
