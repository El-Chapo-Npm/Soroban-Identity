Looking at this task, I need to wire in cache manager and metering/billing functionality. However, the current file doesn't import these modules. Let me analyze what's needed:

1. Import cache manager, metering, and billing modules
2. Initialize cache manager with config and Redis client
3. Attach cache to request context
4. Use cache for DID resolution and query caching
5. Register cache stats/purge routes
6. Start warming scheduler
7. Wire metering middleware
8. Wire billing routes (usage dashboard, invoices)

Since the specific module files aren't shown, I'll need to make reasonable assumptions about their APIs based on the issue requirements. Let me implement this carefully while preserving all existing functionality.

```javascript
import { URL } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appendAuditLog,
  readCredentials,
  writeCredentials,
  createAndPersistCredential,
  revokeAndPersistCredential,
  updateAndPersistCredential,
  DuplicateCredentialError,
  ConcurrencyConflictError,
} from "./storage.js";
import { findExpiringCredentials, paginate } from "./expiry.js";
import {
  setPaginationHeaders,
} from "./routes/pagination.js";
import {
  createWebhookRecord,
  deleteWebhookRecord,
  getWebhookRecord,
  readWebhookLogs,
  readWebhooks,
  WebhookDeliveryService,
} from "./webhooks.js";
import { startAccessLog } from "./access-log.js";
import { createDataLoaders } from "./dataloader.js";
import { executeGraphQL, renderGraphiQLPlayground } from "./graphql.js";
import {
  resolveApiVersion,
  setVersionHeaders,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  DEPRECATED_VERSIONS,
} from "./versioning.js";
import {
  notFound,
  readJson,
  readRawBody,
  requireAdmin,
  requireAuth,
  sendFormatted,
  sendJson,
  sendText,
  setCorsHeaders,
  validateContentType,
} from "./http-utils.js";
import { KEY_ID_HEADER, NonceStore, verifySignedRequest } from "./request-signing.js";
import {
  ENCRYPTION_ENABLED_HEADER,
  ENCRYPTION_KEY_ID_HEADER,
  SessionKeyRegistry,
  decryptSensitiveRequestFields,
  encryptSensitiveResponseFields,
  isEncryptionEnabled,
  negotiateSessionKey,
  wrapResponseEncryption,
} from "./response-encryption.js";
import { normalizeCspReports, setSecurityHeaders } from "./security-headers.js";
import {
  CREDENTIAL_STATUS_TYPE,
  createVcSerializer,
  credentialStatus,
} from "./vc-jsonld.js";

/**
 * Whether the caller wants the W3C JSON-LD representation.
 *
 * Accept is the correct mechanism, but a browser address bar cannot set it,
 * so `?format=jsonld` is honoured as well.
 */
function wantsJsonLd(req, url) {
  if (url.searchParams.get("format") === "jsonld") return true;
  const accept = String(req.headers.accept ?? "");
  return accept.includes("application/ld+json");
}
import { sanitizeDidMetadata, schemas, validateRequest } from "./validation.js";
import {
  buildApiRootLinks,
  buildCredentialCollectionLinks,
  buildCredentialLinks,
  buildDidLinks,
  buildWebhookLinks,
  formatLinkHeader,
  resolveLinkPrefix,
} from "./hateoas.js";
import { routeLabel } from "./route-label.js";
import { requestContextStore } from "./request-context.js";
import { correlationMiddleware, handleTraceRoutes } from "./middleware/tracing.js";
import { cursorPage, offsetMeta, offsetPage, pageNumberMeta } from "./routes/pagination.js";
import { handleEventsRequest } from "./sse.js";
import { handleLongPollRequest } from "./long-poll.js";
import { logger } from "./logger.js";
import { AnalyticsService, detectCountry } from "./analytics.js";
import { createRateLimiter } from "./middleware/ratelimit.js";
import { ApiKeyService } from "./api-keys.js";
import { OAuthService, OAuthError } from "./oauth.js";
import { computeEtag, matchesIfNoneMatch, matchesIfMatch } from "./etag.js";
import { applyFieldFiltering } from "./field-filter.js";
import { createCompressionMiddleware } from "./compression.js";
import { executeBatch } from "./batch.js";
import { readNotificationLog, summarizeNotificationLog } from "./notification-log.js";
import { UsageTracker } from "./analytics/usage.js";
import { EmailTransport } from "./email.js";
import { pickQuotaBinding, QuotaTracker, notifyQuotaThresholdOwner } from "./quota.js";
import { DeprecationRegistry, notifyDeprecatedEndpointOwner } from "./deprecation.js";
import { DdosProtection, ddosResponse } from "./ddos-protection.js";
import { TenantRegistry, handleTenantRoutes, resolveTenantId } from "./tenancy/index.js";
import { openTelemetryHttpMiddleware } from "./tracing/index.js";
import { EventStore, EventReplayer, createEvent, EventTypes, handleEventSourcingRoutes } from "./events/index.js";
import { handleMockApiRequest } from "./mock-api.js";
import { collectHealth, collectReadiness } from "./health.js";
import { CacheManager, CACHE_TTL, cacheKey } from "./cache/index.js";
import { MeteringService, meteringMiddleware, handleBillingRoutes } from "./billing/index.js";
const SERVER_VERSION = "0.1.0";
const MIN_SDK_VERSION = "0.1.0";
const SERVER_FEATURES = [
  "webhook_delivery",
  "batch_issuance",
  "event_polling",
  "graphql_api",
  "api_versioning",
  "quota_tracking",
  "deprecation_warnings",
  "response_compression",
  "job_queue",
  "graceful_shutdown",
  "hateoas",
  "multi_layer_cache",
  "usage_metering",
  "billing",
];

/** Top-level fields selectable via `?fields=` on a credential resource. */
const CREDENTIAL_FIELDS = [
  "id",
  "subject",
  "issuer",
  "type",
  "claims",
  "expiresAt",
  "expires_at",
  "issuedAt",
  "issued_at",
  "revoked",
  "revokedAt",
  "metadata",
];

const usageTracker = new UsageTracker();

export function createApp({
  config,
  soroban,
  metrics,
  metricsAggregator,
  analytics = new AnalyticsService(),
  didCache = null,
  // Health and readiness probes only need something that can answer PING;
  // the DID cache already owns a connected client, so reuse it unless a
  // caller (or a test) supplies one explicitly.
  redisClient = didCache?.client ?? null,
  webhookService = new WebhookDeliveryService(config),
  apiKeyService = new ApiKeyService(config),
  oauthService = new OAuthService(config),
  credentialIssueQueue = config.credentialIssueQueue ?? null,
  batchVerificationQueue = config.batchVerificationQueue ?? null,
  rateLimiter = null,
  accessLogSink = null,
  realtime = null,
  nonceStore = new NonceStore({ ttlSeconds: config.requestSigningMaxAgeSeconds }),
  replayNonceStore = null,
  vcSerializer = createVcSerializer(config, { logger }),
  emailTransport = new EmailTransport(config),
  quotaTracker = null,
  deprecationRegistry = null,
  ddosProtection = null,
  sessionKeyRegistry = null,
  cacheManager = null,
  meteringService = null,
}) {
  // Expose the key service on config so http-utils.requireAuth can validate
  // issued API keys instead of falling back to the single admin key.
  config.apiKeyService = apiKeyService;
  config.oauthService = oauthService;
  
  // Expose job queues on config for route handlers
  config.credentialIssueQueue = credentialIssueQueue;
  config.batchVerificationQueue = batchVerificationQueue;

  // One limiter per app instance, so its buckets live as long as the server
  // rather than being rebuilt per request.
  // #956: per-IP, per-user, endpoint and tier budgets with burst allowance
  // and premium bypass. A caller-supplied limiter only needs a check() method.
  const limiter = rateLimiter ?? createRateLimiter(config, { metrics });

  // One quota tracker per app instance (#748), independent of the rate
  // limiter above: it counts against calendar day/month budgets rather than
  // a rolling per-minute window.
  const quota =
    quotaTracker ??
    new QuotaTracker({
      overageMode: config.quotaOverageMode ?? "block",
      onThreshold: ({ apiKeyId, tier, period, threshold, used, limit }) => {
        metrics?.observeQuotaThreshold?.({ tier, period, threshold });
        logger.warn({ apiKeyId, tier, period, threshold, used, limit }, "API quota threshold reached");
        return notifyQuotaThresholdOwner({ config, apiKeyService, emailTransport, apiKeyId, tier, period, threshold, used, limit });
      },
    });

  const ddos =
    ddosProtection ??
    new DdosProtection(config, {
      onAlert: async (event) => {
        metrics?.observeDdosEvent?.(event.type);
        logger.warn(event, "DDoS protection event");
      },
    });

  // One deprecation registry per app instance (#751).
  const deprecation =
    deprecationRegistry ??
    new DeprecationRegistry({
      onUsage: ({ rule, req }) => {
        metrics?.observeDeprecatedEndpointUsage?.(rule.name);
        logger.warn({ endpoint: rule.name, apiKeyId: req.apiKeyId ?? null, path: req.url }, "Deprecated endpoint used");
        const apiKeyId = req.apiKeyId ?? req.auth?.apiKey?.id ?? null;
        if (!apiKeyId || !deprecation.shouldNotify(apiKeyId, rule.name)) return undefined;
        return notifyDeprecatedEndpointOwner({ config, apiKeyService, emailTransport, apiKeyId, rule });
      },
    });

  // Per-session AES-GCM key registry (#1049). Keys are generated per session,
  // rotated on demand, and never persisted: a restart simply invalidates the
  // sessions that were using them.
  const encryptionKeys =
    sessionKeyRegistry ??
    (isEncryptionEnabled(config)
      ? new SessionKeyRegistry({
          ttlSeconds: config.encryptionSessionKeyTtlSeconds,
          rotationSeconds: config.encryptionKeyRotationSeconds,
          maxKeys: config.encryptionMaxSessionKeys,
        })
      : null);

  const tenantRegistry = new TenantRegistry(config);
  void tenantRegistry.init();

  // #1052: nonce-based replay prevention for sensitive (state-changing)
  // operations. Backed by Redis when available so nonces are shared across
  // instances; falls back to an in-process store otherwise.
  const replayStore =
    replayNonceStore ??
    new NonceStore({ ttlSeconds: config.nonceTtlSeconds ?? 300 });
  const checkNonce = async (req, res) => {
    const nonce = req.headers["x-nonce"] ?? req.headers["x-request-nonce"] ?? null;
    if (!nonce) {
      return {
        ok: false,
        status: 400,
        code: "MISSING_NONCE",
        reason: "missing",
        message: "A request nonce is required for state-changing requests.",
      };
    }
    const accepted = await replayStore.consume(nonce, { scope: req.apiKeyId ?? "" });
    if (!accepted) {
      return {
        ok: false,
        status: 409,
        code: "SIGNATURE_REPLAYED",
        reason: "replayed",
        message: "Request nonce has already been used.",
      };
    }
    return { ok: true, serverNonce: crypto.randomUUID() };
  };

  const eventStore = new EventStore({ dataDir: `${config.dataDir}/events` });
  void eventStore.init();
  const eventReplayer = new EventReplayer(eventStore);

  // #1118: multi-layer caching strategy. L1 is in-memory (LRU), L2 is Redis
  // when available, L3 is CDN via response headers. The manager owns the
  // warming scheduler and the invalidation pipeline.
  const cache =
    cacheManager ??
    new CacheManager({
      config,
      redisClient,
      metrics,
      logger,
    });
  // Start the warming scheduler (no-op when disabled in config).
  if (typeof cache.startWarming === "function") {
    try {
      cache.startWarming();
    } catch (error) {
      logger.warn({ error: error.message }, "Failed to start cache warming scheduler");
    }
  }

  // #1119: API usage metering and billing. The service tracks per-endpoint
  // calls, enforces quotas, and generates invoices. When no service is
  // supplied it is created from config so the routes always exist.
  const metering =
    meteringService ??
    new MeteringService({
      config,
      apiKeyService,
      emailTransport,
      logger,
      metrics,
    });
  const meter = meteringMiddleware({ service: metering, config });

  return async function app(req, res) {
    const startTime = Date.now();
    const url = new URL(
      req.url,
      `http://${req.headers.host ?? "localhost"}`,
    );

    // Resolve API version and normalized pathname
    const { version, normalizedPath, isExplicitUrlVersion, isDeprecated } = resolveApiVersion(req, url);
    const pathname = normalizedPath;

    // Set API Version and Deprecation response headers
    setVersionHeaders(res, { version, isDeprecated, isExplicitUrlVersion });

    // Instrument the request for the Prometheus HTTP metrics. `res.once`
    // fires whether the handler returned a response, threw, or the client
    // disconnected, so in-flight can never leak.
    if (metrics?.observeHttpRequest) {
      const startedAt = process.hrtime.bigint();
      metrics.httpInFlight?.inc();
      res.once("close", () => {
        metrics.httpInFlight?.dec();
        metrics.observeHttpRequest({
          method: req.method,
          route: routeLabel(pathname),
          statusCode: res.statusCode,
          durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1e9,
        });
      });
    }

    // Correlation IDs are validated and normalized by the middleware, then
    // used consistently for both request-ID aliases and downstream context.
    const isMetricsEndpoint = req.method === "GET" && pathname === "/metrics";

    // Resolve tenant context (#800)
    const tenantId = resolveTenantId(req);
    req.tenantId = tenantId;
    res.setHeader("X-Tenant-ID", tenantId);

    // Correlation ID + trace record (#946). Every response, including the
    // metrics endpoint, carries X-Correlation-ID.
    const correlationId = correlationMiddleware(req, res, { path: pathname });
    const requestId = correlationId;

    // #1118: attach the cache manager to the request so handlers can read
    // through it without threading it through every call site.
    req.cache = cache;

    const handler = async () => {
    // Distributed Tracing with OpenTelemetry (#801)
    openTelemetryHttpMiddleware()(req, res);

    // CSP and companion security headers (#754). Set before any branch that
    // can produce a response, so an early return still carries them. The
    // nonce is stashed on the request for the one HTML page we render.
    req.cspNonce = setSecurityHeaders(req, res, config);

    // Apply response compression middleware (#721)
    if (config.compressionEnabled) {
      const compression = createCompressionMiddleware({
        threshold: config.compressionThreshold,
        gzipLevel: config.compressionGzipLevel,
        brotliLevel: config.compressionBrotliLevel,
        enableBrotli: config.compressionEnableBrotli,
        metrics,
      });
      // Apply compression to response
      await compression.middleware()(req, res);
    }

    // Access logging is attached before any routing so a request that is
    // rejected by CORS, auth, or the rate limiter is still recorded.
    if (config.accessLogEnabled && !isMetricsEndpoint) {
      const finishAccessLog = startAccessLog(req, res, {
        requestId,
        config,
        sink: accessLogSink,
      });
      res.on("finish", () => finishAccessLog({ requestBody: req.loggedBody ?? null }));
    }

    // Origin-side DDoS controls run before authentication, body parsing, or RPC work.
    // Health/observability endpoints remain available for load balancers and alerts.
    if (!isMetricsEndpoint && !["/health", "/ready", "/live"].includes(pathname)) {
      const trafficResult = await ddos.check(req);
      if (!trafficResult.allowed) return ddosResponse(res, trafficResult);
    }

    // Apply CORS headers
    if (setCorsHeaders(req, res, config)) {
      // Preflight OPTIONS request
      return res.writeHead(204).end();
    }

    // End-to-end encryption for sensitive credential data (#1049). The
    // middleware wraps sendJson/sendFormatted so any response body produced
    // downstream is encrypted with the session key the client negotiated.
    // It is a no-op unless the feature is enabled and the client presented a
    // key id, so existing clients are unaffected.
    if (isEncryptionEnabled(config)) {
      res.setHeader("X-Encryption-Supported", "aes-256-gcm");
      wrapResponseEncryption(req, res, { config, registry: encryptionKeys });
    }

    // Record analytics when response completes
    res.on("finish", () => {
      const durationMs = Math.max(0, Date.now() - startTime);
      const consumer =
        req.headers["x-api-key"] ||
        req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
        "anonymous";
      const country = detectCountry(req);

      usageTracker.record(req.apiKeyId ?? consumer, {
        method: req.method,
        path: url.pathname,
        statusCode: res.statusCode,
      });

      analytics.recordRequest({
        method: req.method,
        path: url.pathname,
        statusCode: res.statusCode,
        durationMs,
        consumer,
        country,
      });
    });

        if (await handleMockApiRequest(req, res, config)) return;

    // Session key exchange (#1049). Unauthenticated by design: the key it
    // returns is only useful to the client that generated the ephemeral
    // keypair, and it carries no authority of its own. The response is
    // deliberately not encrypted — it is what establishes the key.
    if (req.method === "POST" && pathname === "/encryption/session") {
      if (validateContentType(req, res)) return;
      const body = await readJson(req, config);
      if (body.__payloadTooLarge) {
        return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
      }
      const validated = validateRequest(res, schemas.encryptionSession, { body });
      if (!validated.ok) return;
      try {
        const negotiated = negotiateSessionKey({
          config,
          registry: encryptionKeys,
          clientPublicKey: validated.data.body.clientPublicKey,
          clientKeyId: validated.data.body.keyId ?? null,
        });
        return sendJson(res, 201, negotiated);
      } catch (err) {
        logger.warn({ error: err.message }, "Session key negotiation failed");
        return sendJson(res, 400, {
          error: "key_exchange_failed",
          code: "KEY_EXCHANGE_FAILED",
          message: err.message,
        });
      }
    }

    // Key rotation (#1049). A client that holds a key id may ask for a fresh
    // key; the old one stays valid until its TTL elapses so in-flight
    // responses encrypted with it can still be decrypted.
    if (req.method === "POST" && pathname === "/encryption/rotate") {
      const keyId = req.headers[ENCRYPTION_KEY_ID_HEADER] ?? null;
      if (!keyId) {
        return sendJson(res, 400, {
          error: "missing_key_id",
          code: "MISSING_KEY_ID",
          message: `Provide the current session key id in the ${ENCRYPTION_KEY_ID_HEADER} header.`,
        });
      }
      const rotated = encryptionKeys.rotate(keyId);
      if (!rotated) {
        return sendJson(res, 404, {
          error: "unknown_key_id",
          code: "UNKNOWN_KEY_ID",
          message: "The supplied session key id is unknown or has expired.",
        });
      }
      res.setHeader(ENCRYPTION_KEY_ID_HEADER, rotated.keyId);
      return sendJson(res, 200, {
        keyId: rotated.keyId,
        algorithm: rotated.algorithm,
        expiresAt: rotated.expiresAt,
        previousKeyId: keyId,
      });
    }

    // Validate well-known request headers before any routing or auth work.
    if (!validateRequest(res, schemas.commonHeaders, { headers: req.headers }).ok) {
      return;
    }

    // Decrypt sensitive request fields (#1049) before any handler reads the
    // body. The body is buffered and memoised, so readJson downstream sees
    // the plaintext. A request that claims encryption but cannot be
    // decrypted is rejected rather than silently processed as plaintext.
    if (isEncryptionEnabled(config) && req.headers[ENCRYPTION_ENABLED_HEADER]) {
      const { tooLarge, buffer } = await readRawBody(req, config);
      if (tooLarge) {
        return sendJson(res, 413, {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the size limit.",
        });
      }
      const decrypted = decryptSensitiveRequestFields({
        headers: req.headers,
        body: buffer,
        registry: encryptionKeys,
      });
      if (!decrypted.ok) {
        logger.warn({ code: decrypted.code, route: routeLabel(pathname) }, "Rejected encrypted request");
        return sendJson(res, decrypted.status, {
          error: "decryption_failed",
          code: decrypted.code,
          message: decrypted.message,
        });
      }
      if (decrypted.body !== null) {
        req.rawBody = decrypted.body;
        req.encryptionKeyId = decrypted.keyId ?? null;
      }
    }

    // Extract tier and API key ID from API key or headers early if present
    const authHeader = req.headers["authorization"] || req.headers["x-api-key"];
    if (authHeader) {
      const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : "";
      try {
        const keyRecord = await apiKeyService.validateKey(token);
        if (keyRecord) {
          req.apiKeyId = keyRecord.id;
          req.userTier = keyRecord.tier || 'free';
          req.auth = { apiKey: keyRecord };
        } else {
          const parts = token.split(":");
          if (parts.length >= 2 && ["free", "pro", "enterprise"].includes(parts[1].toLowerCase())) {
            req.userTier = parts[1].toLowerCase();
          }
        }
      } catch {
        // fallback
      }
    }
    if (req.headers["x-user-tier"]) {
      req.userTier = req.headers["x-user-tier"].toLowerCase();
    }

    // Per-endpoint deprecation warnings (#751), independent of the
    // per-version deprecation versioning.js already applied above. Runs
    // after API key extraction so usage logging/notification can be
    // attributed to the calling key.
    const deprecationRule = deprecation.match(req.method, pathname);
    if (deprecationRule) deprecation.handle(req, res, deprecationRule);

    // Rate limiting check (exempt /info, /health, /metrics)
    const isExempt = ["/info", "/health", "/ready", "/live", "/metrics"].includes(url.pathname);

    // #1052: replay prevention. Only state-changing methods are checked, and
    // operational endpoints (plus the browser-posted CSP report) are exempt
    // because they cannot carry client credentials.
    const isNonceExempt = isExempt || pathname === "/csp-report";
    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (!isNonceExempt && isStateChanging) {
      const nonceResult = await checkNonce(req, res);
      if (!nonceResult.ok) {
        metrics?.observeNonceCollision?.(nonceResult.reason ?? "replayed");
        logger.warn(
          { code: nonceResult.code, route: routeLabel(pathname), tenantId },
          "Rejected replayed request nonce",
        );
        return sendJson(res, nonceResult.status ?? 409, {
          error: "nonce_replayed",
          code: nonceResult.code ?? "SIGNATURE_REPLAYED",
          message: nonceResult.message ?? "Request nonce has already been used.",
        });
      }
      // A fresh server nonce is attached to every accepted response so a
      // client can chain requests without reusing a nonce.
      if (nonceResult.serverNonce) {
        res.setHeader("X-Nonce", nonceResult.serverNonce);
      }
    }

    // HMAC request signing (#752). Verified before routing so no handler can
    // act on a request whose body was tampered with or replayed. Operational
    // endpoints are exempt for the same reason they skip rate limiting: a
    // probe has to work without client credentials.
    // A CSP violation report is posted by the browser itself, which has no
    // API key and no signing secret, so it can never carry a signature.
    const isSigningExempt = isExempt || pathname === "/csp-report";

    if (config.requestSigningEnabled && !isSigningExempt) {
      const mustBeSigned =
        config.requestSigningEnforce === "all" ||
        !["GET", "HEAD", "OPTIONS"].includes(req.method);

      if (mustBeSigned) {
        // Buffered here and memoised on the request; the route handler's
        // readJson call reuses these exact bytes.
        const { tooLarge, buffer } = await readRawBody(req, config);
        if (tooLarge) {
          return sendJson(res, 413, {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body exceeds the size limit.",
          });
        }

        // An explicit key id lets a caller sign with a key it is not also
        // authenticating with; otherwise the authenticated key supplies it.
        const signingKeyId = req.headers[KEY_ID_HEADER] ?? req.apiKeyId ?? null;
        const signingSecret = signingKeyId
          ? await apiKeyService.getSigningSecret(signingKeyId)
          : null;

        const verdict = await verifySignedRequest({
          headers: req.headers,
          method: req.method,
          path: req.url,
          body: buffer,
          secret: signingSecret,
          nonceStore,
          maxAgeSeconds: config.requestSigningMaxAgeSeconds,
          scope: signingKeyId ?? "",
        });

        if (!verdict.ok) {
          logger.warn(
            { code: verdict.code, keyId: signingKeyId, route: routeLabel(pathname) },
            "Rejected request signature",
          );
          return sendJson(res, verdict.status, {
            error: "invalid_signature",
            code: verdict.code,
            message: verdict.message,
          });
        }
      }
    }

    if (!isExempt) {
      const rateResult = limiter.check(req, url.pathname);

      if (rateResult.whitelisted) {
        res.setHeader("X-RateLimit-Bypass", rateResult.bypass ?? "whitelist");
      } else {
        // Report whichever budget is closest to exhaustion, so a client sees
        // the limit that will actually stop it first.
        const reported = rateResult.binding ?? rateResult;
        res.setHeader("X-RateLimit-Tier", String(rateResult.tier ?? reported.rule ?? "free"));
        res.setHeader("X-RateLimit-Limit", String(reported.limit));
        res.setHeader("X-RateLimit-Remaining", String(reported.remaining));
        res.setHeader("X-RateLimit-Reset", String(reported.resetAt));
        if (!rateResult.allowed) {
          res.setHeader("X-RateLimit-Scope", rateResult.scope);
        } else if (reported.rule === "ip" || reported.rule === "user") {
          res.setHeader("X-RateLimit-Scope", reported.rule);
        } else if (rateResult.endpoint?.rule) {
          res.setHeader("X-RateLimit-Scope", "tier");
        }
      }

      if (!rateResult.allowed) {
        res.setHeader("Retry-After", String(rateResult.retryAfter));

        // An endpoint denial is not a tier problem, so it must not be dressed
        // up as one — upgrading would not raise a per-endpoint limit.
        const isEndpointDenial = rateResult.scope === "endpoint";
        // Per-IP and per-user denials are abuse controls, not tier limits.
        const isClientDenial = rateResult.scope === "ip" || rateResult.scope === "user";

        if (isClientDenial) {
          return sendJson(res, 429, {
            error: "rate_limit_exceeded",
            code: "RATE_LIMIT_EXCEEDED",
            scope: rateResult.scope,
            message: `Too many requests from this ${rateResult.scope === "ip" ? "IP address" : "account"}. Retry in ${rateResult.retryAfter}s.`,
            limit: rateResult.limit,
            retryAfter: rateResult.retryAfter,
          });
        }

        if (!isEndpointDenial && rateResult.tier === "free") {
          res.setHeader(
            "X-Upgrade-Available",
            "Upgrade to Pro or Enterprise for higher limits: https://soroban-identity.org/pricing"
          );
        }

        const windowMinutes = Math.round(
          ((rateResult.resetAt * 1000) - Date.now()) / 60000
        );

        return sendJson(res, 429, {
          error: "rate_limit_exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          scope: rateResult.scope,
          message: isEndpointDenial
            ? `Rate limit exceeded for '${rateResult.rule}' (${rateResult.limit} requests per window). Retry in ${rateResult.retryAfter}s.`
            : rateResult.tier === "free"
              ? `Free tier rate limit exceeded (${rateResult.limit} req/min). Upgrade to Pro (300 req/min) or Enterprise (1200 req/min) for higher limits.`
              : `Rate limit exceeded for tier '${rateResult.tier}' (${rateResult.limit} req/min).`,
          ...(isEndpointDenial ? { rule: rateResult.rule, windowMinutes } : { tier: rateResult.tier }),
          ...(!isEndpointDenial && rateResult.tier === "free"
            ? {
                upgrade: {
                  message: "Upgrade to Pro or Enterprise for increased rate limits.",
                  upgradeUrl: "https://soroban-identity.org/pricing",
                  availableTiers: ["pro", "enterprise"],
                },
              }
            : {}),
          limit: rateResult.limit,
          retryAfter: rateResult.retryAfter,
        });
      }
    }

    // #1053: resolve the tenant before quota/limit checks so per-tenant
    // budgets apply. The tenant registry is the source of truth for limits.
    const tenant = tenantRegistry.getTenant(tenantId) ?? null;
    req.tenant = tenant;
    if (tenant) {
      const tenantLimits = tenant.limits ?? {};
      if (
        tenantLimits.maxCredentials != null &&
        req.method === "POST" &&
        (pathname === "/credentials" || pathname === "/credentials/issue")
      ) {
        const existing = await readCredentials(config, { tenantId });
        if (existing.length >= tenantLimits.maxCredentials) {
          return sendJson(res, 429, {
            error: "tenant_limit_exceeded",
            code: "TENANT_LIMIT_EXCEEDED",
            scope: "credentials",
            tenantId,
            message: `Tenant '${tenantId}' has reached its credential limit (${tenantLimits.maxCredentials}).`,
          });
        }
      }
      if (
        tenantLimits.maxDids != null &&
        req.method === "POST" &&
        pathname === "/admin/issuers"
      ) {
        const issuers = await soroban.getIssuers();
        if (issuers.length >= tenantLimits.maxDids) {
          return sendJson(res, 429, {
            error: "tenant_limit_exceeded",
            code: "TENANT_LIMIT_EXCEEDED",
            scope: "dids",
            tenantId,
            message: `Tenant '${tenantId}' has reached its DID limit (${tenantLimits.maxDids}).`,
          });
        }
      }
    }

    // Quota check (#748): a separate budget from the rate limit above,
    // measured against calendar day/month boundaries rather than a rolling
    // window. GET /quota itself is exempt so checking your own usage never
    // consumes it.
    if (!isExempt && pathname !== "/quota") {
      const quotaResult = quota.consume(req, tenant ? { tenantId, limits: tenant.limits } : undefined);
      const binding = pickQuotaBinding(quotaResult);
      res.setHeader("X-Quota-Tier", quotaResult.tier);
      res.setHeader("X-Quota-Period", binding.period);
      res.setHeader("X-Quota-Limit", String(binding.limit));
      res.setHeader("X-Quota-Remaining", String(binding.remaining));
      res.setHeader("X-Quota-Reset", String(binding.resetAt));
      if (quotaResult.overage) res.setHeader("X-Quota-Overage", "true");

      if (!quotaResult.allowed) {
        return sendJson(res, 429, {
          error: "quota_exceeded",
          code: "QUOTA_EXCEEDED",
          scope: quotaResult.scope,
          tier: quotaResult.tier,
          message: `${quotaResult.scope === "daily" ? "Daily" : "Monthly"} API quota exceeded for tier '${quotaResult.tier}'.`,
          daily: quotaResult.daily,
          monthly: quotaResult.monthly,
        });
      }
    }

        const linkPrefix = resolveLinkPrefix({ version, isExplicitUrlVersion });

        if (req.method === "GET" && (pathname === "/" || pathname === "/info")) {
          const rootLinks = buildApiRootLinks(linkPrefix);
          return sendJson(
            res,
            200,
            {
              version: SERVER_VERSION,
              apiVersion: version,
              supportedVersions: SUPPORTED_VERSIONS,
              features: SERVER_FEATURES,
              minSdkVersion: MIN_SDK_VERSION,
              encryption: {
                enabled: isEncryptionEnabled(config),
                algorithm: "aes-256-gcm",
                keyExchange: "/encryption/session",
                rotation: "/encryption/rotate",
                keyIdHeader: ENCRYPTION_KEY_ID_HEADER,
                encryptedFields: ["claims", "subject", "credentialSubject"],
              },
              _links: rootLinks,
            },
            { Link: formatLinkHeader(rootLinks) },
          );
        }

        // CSP violation reports (#754). Unauthenticated by necessity — the
        // browser posts these on its own behalf, with no credentials — so the
        // handler only ever logs and counts, and never trusts the contents.
        if (req.method === "POST" && pathname === "/csp-report") {
          const { tooLarge, buffer } = await readRawBody(req, config);
          if (tooLarge) {
            return sendJson(res, 413, {
              code: "PAYLOAD_TOO_LARGE",
              message: "Request body exceeds the size limit.",
            });
          }

          let reports = [];
          try {
            reports = normalizeCspReports(JSON.parse(buffer.toString("utf8") || "{}"));
          } catch {
            // A malformed report is the browser's problem, not something to
            // surface as a server error; it is counted as unparseable and
            // dropped.
            logger.warn({ route: "/csp-report" }, "Discarded unparseable CSP report");
            return res.writeHead(204).end();
          }

          for (const report of reports) {
            logger.warn(
              {
                directive: report.directive,
                blockedUri: report.blockedUri,
                documentUri: report.documentUri,
                sourceFile: report.sourceFile,
                lineNumber: report.lineNumber,
                enforced: !config.cspReportOnly,
              },
              "CSP violation reported",
            );
            metrics?.observeCspViolation?.(report.directive);
          }

          // 204: the browser discards the response body, and there is nothing
          // useful to tell it.
          return res.writeHead(204).end();
        }

        if (req.method === "GET" && pathname === "/health") {
          const health = await collectHealth({
            config,
            soroban,
            redisClient,
            version: SERVER_VERSION,
          });

          const contracts = health.dependencies.contracts?.contracts ?? {};
          // 200 while the service can still answer requests; 503 only when a
          // required dependency is down, so a partially-degraded deployment is
          // not pulled out of a load balancer.
          const statusCode = health.status === "unhealthy" ? 503 : 200;

          return sendJson(res, statusCode, {
            ...health,
            // Retained for existing consumers of this endpoint.
            apiVersion: version,
            supportedVersions: SUPPORTED_VERSIONS,
            deprecatedVersions: DEPRECATED_VERSIONS,
            defaultVersion: DEFAULT_VERSION,
            contracts,
            circuitBreaker: soroban.circuitBreaker.toHealthInfo(),
          });
        }

        if (req.method === "GET" && pathname === "/ready") {
          const readiness = await collectReadiness({
            config,
            soroban,
            redisClient,
            version: SERVER_VERSION,
          });
          return sendJson(res, readiness.ready ? 200 : 503, readiness);
        }

        if (req.method === "GET" && pathname === "/live") {
          // Liveness answers "is the process still running and able to respond"
          // and must never probe a dependency: a dependency outage should not
          // cause the orchestrator to restart an otherwise healthy process.
          return sendJson(res, 200, {
            status: "alive",
            version: SERVER_VERSION,
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
          });
        }

        if (req.method === "GET" && url.pathname === "/events") {
          return handleEventsRequest(req, res, url, { config, soroban });
        }

        if (req.method === "GET" && pathname === "/events/poll") {
          return handleLongPollRequest(req, res, url, { config, soroban });
        }

        if (req.method === "GET" && pathname === "/quota") {
          if (!await requireAuth(req, res, config, [])) return;
          const usage = quota.peek(req);
          return sendJson(res, 200, { ...usage, overageMode: quota.overageMode });
        }

        if (req.method === "GET" && pathname === "/metrics") {
          if (metricsAggregator)
            await metricsAggregator
              .refresh()
              .catch((error) => logger.error({ error: error.message, stack: error.stack }, 'Metrics refresh failed'));

          // Recompute the business gauges at scrape time so they reflect the
          // credential store as it is now, not as it was at the last write.
          if (metrics.updateBusinessMetrics) {
            try {
              metrics.updateBusinessMetrics(await readCredentials(config));
            } catch (error) {
              logger.error({ error: error.message }, 'Business metrics refresh failed');
            }
          }

          const body = await metrics.renderPrometheus();
          return sendText(res, 200, body, metrics.contentType ? { "content-type": metrics.contentType } : {});
        }

        // ── GraphQL Endpoint ─────────────────────────────────────────
        if (pathname === "/graphql") {
          if (req.method === "GET") {
            const queryParam = url.searchParams.get("query");
            if (!queryParam) {
              // Interactive GraphQL Playground in dev mode / browser requests
              res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
              return res.end(renderGraphiQLPlayground(req.cspNonce));
            }
            let variables = {};
            try {
              const varsStr = url.searchParams.get("variables");
              if (varsStr) variables = JSON.parse(varsStr);
            } catch {
              return sendJson(res, 400, { errors: [{ message: "Invalid variables JSON." }] });
            }
            const loaders = createDataLoaders({ config, soroban });
            const result = await executeGraphQL({
              query: queryParam,
              variables,
              context: { config, soroban, metrics, webhookService, loaders, req, res },
            });
            return sendJson(res, result.errors ? 400 : 200, result);
          }

          if (req.method === "POST") {
            if (validateContentType(req, res)) return;
            const body = await readJson(req, config);
            if (body.__payloadTooLarge) {
              return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
            }
            const validated = validateRequest(res, schemas.graphql, { body });
            if (!validated.ok) return;
            const { query, variables = {}, operationName } = validated.data.body;

            // Mutations require credentials:write or admin authorization
            const isMutation = /^\s*mutation\b/i.test(query);
            if (isMutation) {
              if (!await requireAuth(req, res, config, ["credentials:write"])) return;
            }

            const loaders = createDataLoaders({ config, soroban });
            const result = await executeGraphQL({
              query,
              variables,
              operationName,
              context: { config, soroban, metrics, webhookService, loaders, req, res },
            });
            return sendJson(res, 200, result);
          }
        }


        // #390: paginated credential list. #746: opaque cursors, walkable in
        // either direction. #747: optional `?fields=` projection.
        if (req.method === "GET" && pathname === "/credentials") {
          const validated = validateRequest(res, schemas.listCredentials, {
            query: url.searchParams,
          });
          if (!validated.ok) return;
          const limitNum = validated.data.query.limit ?? 50;
          const direction = validated.data.query.direction ?? "next";
          const credentials = await readCredentials(config, { tenantId });
          const { items, nextCursor, previousCursor, pagination } = cursorPage(credentials, {
            limit: limitNum,
            cursor: validated.data.query.cursor ?? null,
            direction,
          });
          setPaginationHeaders(res, url, pagination);

          if (wantsJsonLd(req, url)) {
            return sendJson(
              res,
              200,
              {
                items: items.map((item) => vcSerializer.serialize(item)),
                nextCursor,
                previousCursor,
                pagination,
              },
              { "content-type": "application/ld+json; charset=utf-8" },
            );
          }

          const fieldsResult = applyFieldFiltering(items, validated.data.query.fields, CREDENTIAL_FIELDS);
          if (fieldsResult.error) {
            return sendJson(res, 400, {
              error: "validation_failed",
              code: "VALIDATION_FAILED",
              message: fieldsResult.error,
              errors: [{ field: "fields", source: "query", message: fieldsResult.error, code: "unknown_field" }],
            });
          }
          const projectedItems = fieldsResult.data;

          // Weak: paging through the same query twice can return a
          // representation that differs (a credential issued in between),
          // which the collection ETag should not treat as a hard mismatch.
          const collectionEtag = computeEtag({ items: projectedItems, nextCursor, previousCursor }, { weak: true });
          if (matchesIfNoneMatch(req.headers["if-none-match"], collectionEtag)) {
            res.setHeader("ETag", collectionEtag);
            return res.writeHead(304).end();
          }

          const collectionLinks = buildCredentialCollectionLinks({
            prefix: linkPrefix,
            limit: limitNum,
            nextCursor,
            previousCursor,
          });
          const hasFieldsFilter = Boolean(validated.data.query?.fields);
          const itemsWithLinks = hasFieldsFilter
            ? projectedItems
            : projectedItems.map((item) => ({
                ...item,
                _links: buildCredentialLinks(item, linkPrefix),
              }));

          if (version === "v2") {
            return sendJson(
              res,
              200,
              {
                apiVersion: "v2",
                data: {
                  items: itemsWithLinks,
                  pageInfo: {
                    nextCursor,
                    previousCursor,
                    hasNextPage: Boolean(nextCursor),
                    hasPreviousPage: Boolean(previousCursor),
                    count: projectedItems.length,
                  },
                  pagination,
                },
                meta: {
                  timestamp: new Date().toISOString(),
                },
                _links: collectionLinks,
              },
              { ETag: collectionEtag },
            );
          }
          return sendJson(
            res,
            200,
            { items: itemsWithLinks, nextCursor, previousCursor, pagination, _links: collectionLinks },
            { ETag: collectionEtag },
          );
        }

        // Single-item GET /credentials/:id. #745: strong ETag + conditional
        // GET. #747: optional `?fields=` projection. #1069: HATEOAS _links.
        const credentialIdMatch = pathname.match(/^\/credentials\/([^/]+)$/);
        if (req.method === "GET" && credentialIdMatch) {
          const credentialId = decodeURIComponent(credentialIdMatch[1]);
          const validated = validateRequest(res, schemas.credentialByIdParams, {
            params: { credentialId },
            query: url.searchParams,
          });
          if (!validated.ok) return;
          const credentials = await readCredentials(config, { tenantId });
          const credential = credentials.find((c) => c.id === credentialId);
          if (!credential) return notFound(res, req);

          // W3C JSON-LD form (#753), opt-in so existing clients keep the
          // compact internal shape they already parse. Requested either by
          // Accept: application/ld+json or ?format=jsonld — the query
          // parameter exists because a browser cannot easily set Accept.
          if (wantsJsonLd(req, url)) {
            return sendJson(
              res,
              200,
              vcSerializer.serialize(credential),
              { "content-type": "application/ld+json; charset=utf-8" },
            );
          }

          const fieldsResult = applyFieldFiltering(credential, validated.data.query?.fields, CREDENTIAL_FIELDS);
          if (fieldsResult.error) {
            return sendJson(res, 400, {
              error: "validation_failed",
              code: "VALIDATION_FAILED",
              message: fieldsResult.error,
              errors: [{ field: "fields", source: "query", message: fieldsResult.error, code: "unknown_field" }],
            });
          }
          const projectedCredential = fieldsResult.data;

          // Strong: computed from the canonical (unfiltered) credential, not
          // whatever `fields` this particular request asked for — so the
          // ETag identifies the resource's state consistently regardless of
          // which representation a client happens to request, and stays
          // valid in an If-Match precondition on a later write (which always
          // compares against the canonical object; see the revoke handler).
          const etag = computeEtag(credential);
          if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
            res.setHeader("ETag", etag);
            return res.writeHead(304).end();
          }

          const itemLinks = buildCredentialLinks(credential, linkPrefix);
          const payloadWithLinks = validated.data.query?.fields
            ? projectedCredential
            : { ...projectedCredential, _links: itemLinks };

          if (version === "v2") {
            return sendJson(
              res,
              200,
              { apiVersion: "v2", data: payloadWithLinks, _links: itemLinks },
              { ETag: etag, Link: formatLinkHeader(itemLinks) },
            );
          }
          return sendJson(res, 200, payloadWithLinks, { ETag: etag, Link: formatLinkHeader(itemLinks) });
        }

        // Credential status (#753). Referenced by every credential's
        // `credentialStatus` entry, so a verifier can check revocation
        // against the issuer rather than trusting the copy it holds.
        const credentialStatusMatch = pathname.match(/^\/credentials\/([^/]+)\/status$/);
        if (req.method === "GET" && credentialStatusMatch) {
          const credentialId = decodeURIComponent(credentialStatusMatch[1]);
          if (!validateRequest(res, schemas.credentialByIdParams, { params: { credentialId } }).ok) {
            return;
          }
          const credentials = await readCredentials(config, { tenantId });
          const credential = credentials.find((c) => c.id === credentialId);
          if (!credential) return notFound(res);

          const status = credentialStatus(credential);
          const statusLinks = buildCredentialLinks(credential, linkPrefix);
          return sendJson(res, 200, {
            id: `${pathname}`,
            type: CREDENTIAL_STATUS_TYPE,
            credentialId,
            ...status,
            checkedAt: new Date().toISOString(),
            _links: {
              ...statusLinks,
              self: { href: `${linkPrefix}${pathname}`, method: "GET" },
              credential: { href: `${linkPrefix}/credentials/${encodeURIComponent(credentialId)}`, method: "GET" },
            },
          });
        }

        // Encrypted credential payload (#1049). Returns only the sensitive
        // fields, encrypted with the caller's session key, so a client can
        // fetch credential material without it ever appearing in plaintext
        // on the wire.
        const encryptedCredentialMatch = pathname.match(/^\/credentials\/([^/]+)\/encrypted$/);
        if (req.method === "GET" && encryptedCredentialMatch) {
          if (!await requireAuth(req, res, config, ['credentials:read'])) return;
          const credentialId = decodeURIComponent(encryptedCredentialMatch[1]);
          if (!validateRequest(res, schemas.credentialByIdParams, { params: { credentialId } }).ok) {
            return;
          }
          const keyId = req.headers[ENCRYPTION_KEY_ID_HEADER] ?? null;
          if (!keyId || !encryptionKeys.has(keyId)) {
            return sendJson(res, 400, {
              error: "missing_session_key",
              code: "MISSING_SESSION_KEY",
              message: `Negotiate a session key at POST /encryption/session and send it in the ${ENCRYPTION_KEY_ID_HEADER} header.`,
            });
          }
          const credentials = await readCredentials(config);
          const credential = credentials.find((c) => c.id === credentialId);
          if (!credential) return notFound(res, req);

          const sensitive = {
            claims: credential.claims ?? null,
            subject: credential.subject ?? null,
            credentialSubject: credential.credentialSubject ?? null,
          };
          const encrypted = encryptSensitiveResponseFields(sensitive, {
            registry: encryptionKeys,
            keyId,
          });
          if (!encrypted) {
            return sendJson(res, 500, {
              error: "encryption_failed",
              code: "ENCRYPTION_FAILED",
              message: "Unable to encrypt the credential payload.",
            });
          }
          res.setHeader(ENCRYPTION_KEY_ID_HEADER, encrypted.keyId);
          return sendJson(res, 200, {
            credentialId,
            algorithm: encrypted.algorithm,
            keyId: encrypted.keyId,
            iv: encrypted.iv,
            tag: encrypted.tag,
            ciphertext: encrypted.ciphertext,
            encryptedAt: new Date().toISOString(),
          });
        }

        const verifyMatch = pathname.match(/^\/credentials\/([^/]+)\/verify$/);
        if (req.method === "POST" && verifyMatch) {
          // Verify endpoint requires credentials:read scope
          if (!await requireAuth(req, res, config, ['credentials:read'])) return;
          
          const credentialId = decodeURIComponent(verifyMatch[1]);
          if (!validateRequest(res, schemas.credentialByIdParams, { params: { credentialId } }).ok) {
            return;
          }
          const credentials = await readCredentials(config, { tenantId });
          const credential = credentials.find((c) => c.id === credentialId);
          const recordVerification = (result) =>
            metrics?.observeCredentialVerification?.(result);
          if (!credential) {
            recordVerification("not_found");
            return sendFormatted(req, res, 200, { verified: false, reason: "not_found" });
          }
          if (credential.revoked) {
            recordVerification("revoked");
            return sendFormatted(req, res, 200, { verified: false, reason: "revoked" });
          }
          const now = Math.floor(Date.now() / 1000);
          if (credential.expiresAt > 0 && credential.expiresAt < now) {
            recordVerification("expired");
            return sendFormatted(req, res, 200, { verified: false, reason: "expired" });
          }
          recordVerification("verified");
          return sendFormatted(req, res, 200, { verified: true, credential });
        }

        // Interactive Swagger UI (#830)
        if (req.method === "GET" && (pathname === "/api/docs" || pathname === "/api/docs/")) {
          try {
            const html = await fs.readFile(new URL("../../docs/api/swagger.html", import.meta.url), "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            return res.end(html.replace("__SPEC_URL__", "/openapi.json"));
          } catch (err) {
            return sendJson(res, 500, { error: "swagger_ui_unavailable", message: err.message });
          }
        }

        if (req.method === "GET" && pathname === "/openapi.json") {
          try {
            const openApiPath = path.resolve(process.cwd(), "openapi.json");
            const content = await fs.readFile(openApiPath, "utf8");
            return sendJson(res, 200, JSON.parse(content));
          } catch {
            try {
              const fallbackPath = path.resolve(process.cwd(), "server/openapi.json");
              const content = await fs.readFile(fallbackPath, "utf8");
              return sendJson(res, 200, JSON.parse(content));
            } catch (err) {
              return sendJson(res, 500, { error: "openapi_spec_unavailable", message: err.message });
            }
          }
        }

        // ── OAuth 2.0 Authorization Server (#744) ───────────────────────
        if (req.method === "POST" && pathname === "/oauth/clients") {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.registerOAuthClient, { body });
          if (!validated.ok) return;
          try {
            const client = await oauthService.registerClient(validated.data.body);
            await appendAuditLog(config, {
              action: "register_oauth_client",
              actor: req.headers["x-actor"] ?? config.adminActor,
              clientId: client.clientId,
            });
            return sendJson(res, 201, client);
          } catch (err) {
            if (err instanceof OAuthError) {
              return sendJson(res, err.status, { error: err.code, message: err.message });
            }
            throw err;
          }
        }

        if (req.method === "GET" && pathname === "/oauth/authorize") {
          const validated = validateRequest(res, schemas.oauthAuthorizeQuery, { query: url.searchParams });
          if (!validated.ok) return;
          // The "resource owner" is whoever is already authenticated on this
          // request; there is no separate login/consent page (see oauth.js).
          if (!await requireAuth(req, res, config, [])) return;
          const { client_id: clientId, redirect_uri: redirectUri, scope, state } = validated.data.query;
          try {
            const { code, redirectUri: destination, state: echoedState } = await oauthService.authorize({
              clientId,
              redirectUri,
              scope,
              state,
              subject: req.apiKeyId ?? null,
              ownerScopes: req.apiKeyScopes ?? [],
            });
            const target = new URL(destination);
            target.searchParams.set("code", code);
            if (echoedState !== null) target.searchParams.set("state", echoedState);
            res.writeHead(302, { Location: target.toString() });
            return res.end();
          } catch (err) {
            if (err instanceof OAuthError) {
              return sendJson(res, err.status, { error: err.code, error_description: err.message });
            }
            throw err;
          }
        }

        if (req.method === "POST" && pathname === "/oauth/token") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.oauthToken, { body });
          if (!validated.ok) return;
          const input = validated.data.body;
          try {
            const tokens =
              input.grant_type === "authorization_code"
                ? await oauthService.exchangeAuthorizationCode({
                    code: input.code,
                    clientId: input.client_id,
                    clientSecret: input.client_secret,
                    redirectUri: input.redirect_uri,
                  })
                : await oauthService.exchangeRefreshToken({
                    refreshToken: input.refresh_token,
                    clientId: input.client_id,
                    clientSecret: input.client_secret,
                    scope: input.scope,
                  });
            return sendJson(res, 200, tokens);
          } catch (err) {
            if (err instanceof OAuthError) {
              return sendJson(res, err.status, { error: err.code, error_description: err.message });
            }
            throw err;
          }
        }

        if (req.method === "POST" && pathname === "/oauth/introspect") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.oauthIntrospect, { body });
          if (!validated.ok) return;
          const { token, client_id: clientId, client_secret: clientSecret } = validated.data.body;
          // RFC 7662: the endpoint must itself be protected. A caller either
          // authenticates as the OAuth client the token was issued to, or as
          // an admin.
          if (!clientId && !await requireAuth(req, res, config, ['admin:read'])) return;
          try {
            const result = await oauthService.introspect(token, { clientId, clientSecret });
            return sendJson(res, 200, result);
          } catch (err) {
            if (err instanceof OAuthError) {
              return sendJson(res, err.status, { error: err.code, error_description: err.message });
            }
            throw err;
          }
        }

        if (req.method === "POST" && pathname === "/oauth/revoke") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.oauthRevoke, { body });
          if (!validated.ok) return;
          const { token, client_id: clientId, client_secret: clientSecret } = validated.data.body;
          if (!clientId && !await requireAuth(req, res, config, ['admin:write'])) return;
          try {
            await oauthService.revoke(token, { clientId, clientSecret });
            // RFC 7009: always 200, whether or not the token was known.
            return sendJson(res, 200, { revoked: true });
          } catch (err) {
            if (err instanceof OAuthError) {
              return sendJson(res, err.status, { error: err.code, error_description: err.message });
            }
            throw err;
          }
        }

        if (
          pathname.startsWith("/admin/") &&
          !(await requireAdmin(req, res, config))
        )
          return;

        // Request traces API and dashboard (#946)
        if (pathname.startsWith("/admin/traces")) {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          if (handleTraceRoutes(req, res, { pathname, searchParams: url.searchParams }, { sendJson, nonce: req.cspNonce })) return;
        }

        // Per-key API usage (#888)
        if (req.method === "GET" && url.pathname === "/analytics/usage") {
          if (!await requireAuth(req, res, config, [])) return;
          const consumer = req.apiKeyId ?? req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "anonymous";
          return sendFormatted(req, res, 200, usageTracker.getUsage(consumer, {
            period: url.searchParams.get("period") ?? "day",
            tier: req.userTier ?? "free",
          }));
        }

        // Analytics Dashboard
        if (req.method === "GET" && url.pathname === "/admin/analytics/dashboard") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(analytics.renderDashboardHtml());
        }

        // Analytics Export (CSV or JSON)
        if (req.method === "GET" && url.pathname === "/admin/analytics/export") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const format = url.searchParams.get("format")?.toLowerCase();
          if (format === "json" || req.headers["accept"] === "application/json") {
            return sendFormatted(req, res, 200, analytics.exportJson(), {
              "content-disposition": 'attachment; filename="analytics.json"',
            });
          }
          res.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="analytics.csv"',
          });
          return res.end(analytics.exportCsv());
        }

        // Analytics Summary Data
        if (req.method === "GET" && url.pathname === "/admin/analytics") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          return sendFormatted(req, res, 200, analytics.getSummary());
        }

        if (req.method === "POST" && (pathname === "/credentials" || pathname === "/credentials/issue")) {
          if (!await requireAuth(req, res, config, ['credentials:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          const validated = validateRequest(res, schemas.issueCredential, { body });
          if (!validated.ok) return;
          const credential = validated.data.body;
          try {
            await createAndPersistCredential(config, credential, { tenantId });
            await appendAuditLog(config, { action: "issue_credential", credentialId: credential.id });
            webhookService.trigger("credential.issued", credential).catch(() => {});
            realtime?.emitCredentialEvent("issued", credential);
            if (wantsJsonLd(req, url)) {
              return sendJson(
                res,
                201,
                vcSerializer.serialize(credential),
                { "content-type": "application/ld+json; charset=utf-8" },
              );
            }
            const createdLinks = buildCredentialLinks(credential, linkPrefix);
            return sendJson(
              res,
              201,
              { ...credential, _links: createdLinks },
              {
                Location: createdLinks.self?.href ?? `/credentials/${encodeURIComponent(credential.id)}`,
                Link: formatLinkHeader(createdLinks),
              },
            );
          } catch (err) {
            if (err instanceof DuplicateCredentialError) {
              return sendFormatted(req, res, 409, {
                code: "CREDENTIAL_ALREADY_EXISTS",
                message: err.message,
                details: [{ field: "id", value: err.id }],
              });
            }
            throw err;
          }
        }

        // Credential revocation: DELETE /credentials/:id/revoke or POST /credentials/:id/revoke or DELETE /credentials/:id
        const revokeMatch = pathname.match(/^\/credentials\/([^/]+)(\/revoke)?$/);
        if ((req.method === "DELETE" || (req.method === "POST" && pathname.endsWith("/revoke"))) && revokeMatch) {
          if (!await requireAuth(req, res, config, ['credentials:write'])) return;
          const credentialId = decodeURIComponent(revokeMatch[1]);
          if (!validateRequest(res, schemas.credentialByIdParams, { params: { credentialId } }).ok) {
            return;
          }

          // Optimistic concurrency (#745): If-Match lets a caller refuse to
          // revoke a credential it has not actually seen the current state
          // of — e.g. it read the credential, another client already revoked
          // it, and this request was built from the stale copy.
          const ifMatch = req.headers["if-match"];
          if (ifMatch) {
            const existing = (await readCredentials(config, { tenantId })).find((c) => c.id === credentialId);
            if (!existing) return notFound(res);
            if (!matchesIfMatch(ifMatch, computeEtag(existing))) {
              return sendJson(res, 412, {
                code: "PRECONDITION_FAILED",
                message: "If-Match header does not match the current credential state.",
              });
            }
          }

          const revoked = await revokeAndPersistCredential(config, credentialId, { tenantId });
          if (!revoked) return notFound(res);
          await appendAuditLog(config, { action: "revoke_credential", credentialId });
          webhookService.trigger("credential.revoked", { id: credentialId, revokedAt: revoked.revokedAt }).catch(() => {});
          realtime?.emitCredentialEvent("revoked", revoked);
          const revokedLinks = buildCredentialLinks(revoked, linkPrefix);
          return sendJson(
            res,
            200,
            {
              revoked: true,
              credential: { ...revoked, _links: revokedLinks },
              _links: revokedLinks,
            },
            { Link: formatLinkHeader(revokedLinks) },
          );
        }

        // Credential update: PUT /credentials/:id or PATCH /credentials/:id with optimistic concurrency
        const updateMatch = pathname.match(/^\/credentials\/([^/]+)$/);
        if ((req.method === "PUT" || req.method === "PATCH") && updateMatch) {
          if (!await requireAuth(req, res, config, ['credentials:write'])) return;
          if (validateContentType(req, res)) return;
          const credentialId = decodeURIComponent(updateMatch[1]);
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });

          // Check version from If-Match header or body
          const ifMatchHeader = req.headers['if-match'];
          const expectedVersion = ifMatchHeader
            ? ifMatchHeader.replace(/^"|"$/g, '')
            : (body.version ?? body.expectedVersion);

          try {
            const updated = await updateAndPersistCredential(config, credentialId, body, expectedVersion, { tenantId });
            if (!updated) return notFound(res);
            await appendAuditLog(config, { action: "update_credential", credentialId });
            webhookService.trigger("credential.updated", updated).catch(() => {});
            realtime?.emitCredentialEvent("updated", updated);
            return sendJson(res, 200, updated, { ETag: `"${updated.version}"` });
          } catch (err) {
            if (err instanceof ConcurrencyConflictError) {
              return sendJson(res, 409, {
                code: "CONCURRENCY_CONFLICT",
                message: err.message,
                details: [
                  { field: "version", expected: err.expectedVersion, current: err.currentVersion },
                ],
              });
            }
            throw err;
          }
        }

        // ── Batch Operations (#749) ─────────────────────────────────────
        if (req.method === "POST" && pathname === "/batch") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          const validated = validateRequest(res, schemas.batchOperations, { body });
          if (!validated.ok) return;
          const { operations, atomic } = validated.data.body;

          // Auth requirement follows whichever operation types are present:
          // issue/revoke mutate state and need write scope, verify only reads.
          const types = new Set(operations.map((op) => op.type));
          const requiredScopes = [];
          if (types.has("issue") || types.has("revoke")) requiredScopes.push("credentials:write");
          if (types.has("verify")) requiredScopes.push("credentials:read");
          if (!await requireAuth(req, res, config, requiredScopes)) return;

          const batchResult = await executeBatch(
            { operations, atomic: Boolean(atomic) },
            { config, webhookService, realtime, metrics },
          );
          return sendJson(res, 200, batchResult);
        }

        // ── Webhook Endpoints ──────────────────────────────────────────
        if (req.method === "GET" && pathname === "/webhooks") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const allWebhooks = await readWebhooks(config);
          // No `limit` returns the full list, as before (#944).
          const { items: webhooks, pagination } = offsetPage(allWebhooks, {
            limit: url.searchParams.get("limit") ?? Math.max(allWebhooks.length, 1),
            offset: url.searchParams.get("offset"),
            maxPageSize: Math.max(200, allWebhooks.length),
          });
          setPaginationHeaders(res, url, pagination);
          return sendJson(res, 200, { webhooks, pagination });
        }

        if (req.method === "POST" && pathname === "/webhooks") {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          const validated = validateRequest(res, schemas.createWebhook, { body });
          if (!validated.ok) return;
          const webhook = await createWebhookRecord(config, validated.data.body);
          return sendJson(res, 201, webhook);
        }

        if (req.method === "GET" && pathname === "/webhooks/logs") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const validated = validateRequest(res, schemas.webhookLogsQuery, { query: url.searchParams });
          if (!validated.ok) return;
          const limit = validated.data.query.limit ?? 50;
          const webhookId = validated.data.query.webhookId ?? null;
          const allLogs = await readWebhookLogs(config, { webhookId, limit: null });
          const { items: logs, pagination } = offsetPage(allLogs, {
            limit,
            offset: url.searchParams.get("offset"),
          });
          setPaginationHeaders(res, url, pagination);
          return sendJson(res, 200, { logs, pagination });
        }

        if (req.method === "GET" && pathname === "/notifications/logs") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
          if (limit > 200) {
            return sendJson(res, 400, { code: "INVALID_REQUEST", message: "limit must not exceed 200" });
          }
          const allLogs = await readNotificationLog(config, {
            credentialId: url.searchParams.get("credentialId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
          });
          // Without `offset`, keep the historical "most recent `limit`" view.
          const offsetParam = url.searchParams.get("offset");
          const offset = offsetParam === null ? Math.max(0, allLogs.length - limit) : offsetParam;
          const { items: logs, pagination } = offsetPage(allLogs, { limit, offset });
          setPaginationHeaders(res, url, pagination);
          return sendJson(res, 200, { logs, pagination });
        }

        if (req.method === "GET" && pathname === "/cache/stats") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          return sendJson(res, 200, didCache ? didCache.getStats() : { enabled: false });
        }

        if (req.method === "DELETE" && pathname === "/cache/dids") {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          const cleared = didCache ? await didCache.invalidateAll() : 0;
          return sendJson(res, 200, { cleared });
        }

        const cacheDidMatch = pathname.match(/^\/cache\/dids\/([^/]+)$/);
        if (req.method === "DELETE" && cacheDidMatch) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          const did = decodeURIComponent(cacheDidMatch[1]);
          const invalidated = didCache ? await didCache.invalidate(did) : false;
          return sendJson(res, 200, { did, invalidated });
        }

        // ── DID Resolution & Metadata Endpoints (#1067) ────────────────
        if (req.method === "POST" && (pathname === "/dids" || pathname === "/identity/did")) {
          // These writes land in the DID cache, which resolveDid() reads
          // before the chain, so an unauthenticated write could poison any
          // DID's resolved document.
          if (!await requireAuth(req, res, config, ["admin:write"])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.upsertDid, { body });
          if (!validated.ok) return;
          const rawIdentifier = validated.data.body.did ?? validated.data.body.address ?? "";
          if (!rawIdentifier) {
            return sendJson(res, 400, {
              error: "validation_failed",
              code: "VALIDATION_FAILED",
              message: "Either did or address is required.",
            });
          }
          const address = rawIdentifier.startsWith("did:stellar:")
            ? rawIdentifier.slice("did:stellar:".length)
            : rawIdentifier;
          const safeMetadata = sanitizeDidMetadata(body.metadata ?? validated.data.body.metadata ?? {});
          const nowSec = Math.floor(Date.now() / 1000);
          const didDoc = {
            id: `did:stellar:${address}`,
            controller: validated.data.body.controller ?? `did:stellar:${address}`,
            createdAt: nowSec,
            updatedAt: nowSec,
            metadata: safeMetadata,
            active: validated.data.body.active !== false,
          };
          if (didCache) {
            await didCache.set(address, didDoc);
          }
          const didLinks = buildDidLinks(didDoc, linkPrefix);
          return sendJson(
            res,
            pathname === "/identity/did" ? 200 : 201,
            { ...didDoc, _links: didLinks },
            { Link: formatLinkHeader(didLinks) },
          );
        }

        const didRouteMatch = pathname.match(/^\/dids\/([^/]+)(\/metadata)?$/);
        if (didRouteMatch) {
          let rawDid;
          try {
            rawDid = decodeURIComponent(didRouteMatch[1]);
          } catch {
            return sendJson(res, 400, { code: "INVALID_DID", message: "Malformed URL-encoded DID parameter." });
          }
          const address = rawDid.startsWith("did:stellar:") ? rawDid.slice("did:stellar:".length) : rawDid;

          if (req.method === "GET") {
            const doc = soroban?.resolveDid ? await soroban.resolveDid(address) : null;
            if (!doc) return notFound(res, req);
            const didLinks = buildDidLinks(doc, linkPrefix);
            return sendJson(
              res,
              200,
              {
                ...doc,
                metadata: sanitizeDidMetadata(doc.metadata ?? {}),
                _links: didLinks,
              },
              { Link: formatLinkHeader(didLinks) },
            );
          }

          if (req.method === "PUT" || req.method === "PATCH") {
            // Same cache-poisoning risk as POST /dids above.
            if (!await requireAuth(req, res, config, ["admin:write"])) return;
            if (validateContentType(req, res)) return;
            const body = await readJson(req, config);
            if (body.__payloadTooLarge) {
              return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
            }
            const rawMetadata = body.metadata !== undefined ? body.metadata : body;
            if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
              return sendJson(res, 400, {
                error: "validation_failed",
                code: "VALIDATION_FAILED",
                message: "DID metadata must be a JSON object.",
              });
            }
            const safeMetadata = sanitizeDidMetadata(rawMetadata);
            const existing = (soroban?.resolveDid ? await soroban.resolveDid(address) : null) ?? {
              id: `did:stellar:${address}`,
              controller: `did:stellar:${address}`,
              createdAt: Math.floor(Date.now() / 1000),
              active: true,
              metadata: {},
            };
            const updatedDoc = {
              ...existing,
              updatedAt: Math.floor(Date.now() / 1000),
              metadata: req.method === "PATCH" ? { ...(existing.metadata ?? {}), ...safeMetadata } : safeMetadata,
            };
            if (didCache) {
              await didCache.set(address, updatedDoc);
            }
            const didLinks = buildDidLinks(updatedDoc, linkPrefix);
            return sendJson(
              res,
              200,
              { ...updatedDoc, _links: didLinks },
              { Link: formatLinkHeader(didLinks) },
            );
          }
        }

        if (req.method === "GET" && pathname === "/notifications/summary") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const summary = await summarizeNotificationLog(config);
          return sendJson(res, 200, summary);
        }

        const webhookTestMatch = pathname.match(/^\/webhooks\/([^/]+)\/test$/);
        if (req.method === "POST" && (webhookTestMatch || pathname === "/webhooks/test")) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          let webhook;
          if (webhookTestMatch) {
            const id = decodeURIComponent(webhookTestMatch[1]);
            webhook = await getWebhookRecord(config, id);
            if (!webhook) return notFound(res);
          } else {
            if (validateContentType(req, res)) return;
            const body = await readJson(req, config);
            const validated = validateRequest(res, schemas.testWebhook, { body });
            if (!validated.ok) return;
            webhook = {
              id: "whk_test",
              url: validated.data.body.url,
              secret: validated.data.body.secret || "test-secret",
              authToken: validated.data.body.authToken,
            };
          }
          const testResult = await webhookService.deliverTest(webhook);
          return sendJson(res, 200, testResult);
        }

        const webhookLogsMatch = pathname.match(/^\/webhooks\/([^/]+)\/logs$/);
        if (req.method === "GET" && webhookLogsMatch) {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const webhookId = decodeURIComponent(webhookLogsMatch[1]);
          const validated = validateRequest(res, schemas.webhookLogsQuery, { query: url.searchParams });
          if (!validated.ok) return;
          const limit = validated.data.query.limit ?? 50;
          const allLogs = await readWebhookLogs(config, { webhookId, limit: null });
          const { items: logs, pagination } = offsetPage(allLogs, {
            limit,
            offset: url.searchParams.get("offset"),
          });
          setPaginationHeaders(res, url, pagination);
          return sendJson(res, 200, { logs, pagination });
        }

        const webhookIdMatch = pathname.match(/^\/webhooks\/([^/]+)$/);
        if (req.method === "GET" && webhookIdMatch && pathname !== "/webhooks/logs") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const id = decodeURIComponent(webhookIdMatch[1]);
          const webhook = await getWebhookRecord(config, id);
          if (!webhook) return notFound(res);
          return sendJson(res, 200, webhook);
        }

        if (req.method === "DELETE" && webhookIdMatch) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          const id = decodeURIComponent(webhookIdMatch[1]);
          const deleted = await deleteWebhookRecord(config, id);
          if (!deleted) return notFound(res);
          return sendJson(res, 200, { success: true, id });
        }

        if (req.method === "GET" && pathname === "/admin/issuers") {
          // Reading issuers requires admin:read or wildcard scope
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          
          const allIssuers = await soroban.getIssuers();
          // No `limit` returns the full list, as before (#944).
          const { items: issuers, pagination } = offsetPage(allIssuers, {
            limit: url.searchParams.get("limit") ?? Math.max(allIssuers.length, 1),
            offset: url.searchParams.get("offset"),
            maxPageSize: Math.max(200, allIssuers.length),
          });
          setPaginationHeaders(res, url, pagination);
          return sendFormatted(req, res, 200, { issuers, pagination });
        }

        if (req.method === "POST" && pathname === "/admin/issuers") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendFormatted(req, res, 413, { error: "payload_too_large" });
          const validated = validateRequest(res, schemas.addIssuer, { body });
          if (!validated.ok) return;
          const { issuer } = validated.data.body;
          await soroban.addIssuer(issuer);
          realtime?.emitDidEvent("issuer_added", issuer, { subject: issuer });
          await appendAuditLog(config, {
            action: "add_issuer",
            actor: req.headers["x-actor"] ?? config.adminActor,
            issuer,
          });
          return sendFormatted(req, res, 201, { issuer: body.issuer });
        }

        if (req.method === "DELETE" && pathname === "/admin/issuers") {
          // Removing issuers requires admin:write scope
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendFormatted(req, res, 413, { error: "payload_too_large" });
          const validated = validateRequest(res, schemas.removeIssuer, {
            body,
            query: url.searchParams,
          });
          if (!validated.ok) return;
          const issuer = validated.data.body.issuer ?? validated.data.query.issuer;
          if (!issuer) {
            return sendJson(res, 400, {
              error: "validation_failed",
              code: "VALIDATION_FAILED",
              message: "Request validation failed.",
              errors: [
                {
                  field: "issuer",
                  source: "body",
                  message: "issuer is required in the request body or as a query parameter",
                  code: "required",
                },
              ],
            });
          }
          await soroban.removeIssuer(issuer);
          realtime?.emitDidEvent("issuer_removed", issuer, { subject: issuer });
          await appendAuditLog(config, {
            action: "remove_issuer",
            actor: req.headers["x-actor"] ?? config.adminActor,
            issuer,
          });
          return sendFormatted(req, res, 200, { issuer });
        }

        if (req.method === "GET" && pathname === "/admin/expiry-report") {
          // Reading expiry reports requires admin:read scope
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          
          const validated = validateRequest(res, schemas.expiryReportQuery, {
            query: url.searchParams,
          });
          if (!validated.ok) return;
          const windowDays = validated.data.query.windowDays ?? config.expiryWarningDays;
          const credentials = await readCredentials(config, { tenantId });
          const expiring = findExpiringCredentials(credentials, {
            windowDays,
            includeNotified: true,
          });
          const report = paginate(expiring, {
            page: validated.data.query.page ?? null,
            pageSize: validated.data.query.pageSize ?? null,
          });
          const pagination = pageNumberMeta(report);
          setPaginationHeaders(res, url, pagination, { offsetParam: "page", limitParam: "pageSize" });
          return sendFormatted(req, res, 200, { ...report, pagination });
        }

        if (req.method === "GET" && (url.pathname === "/admin/expiry-thresholds" || url.pathname === "/expiry/thresholds")) {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          return sendJson(res, 200, {
            thresholds: config.expiryReminderThresholds ?? [30, 7, 1],
            warningDays: config.expiryWarningDays ?? 7,
          });
        }

        if (req.method === "POST" && (url.pathname === "/admin/expiry-thresholds" || url.pathname === "/expiry/thresholds")) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }
          const validated = validateRequest(res, schemas.expiryThresholds, { body });
          if (!validated.ok) return;
          const validThresholds = [...validated.data.body.thresholds].sort((a, b) => b - a);

          config.expiryReminderThresholds = validThresholds;
          await appendAuditLog(config, {
            action: "update_expiry_thresholds",
            thresholds: validThresholds,
          });

          return sendJson(res, 200, {
            success: true,
            thresholds: validThresholds,
          });
        }

        // #679: API Key Management Endpoints
        if (req.method === "POST" && url.pathname === "/admin/api-keys") {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge) {
            return sendJson(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          }

          const validated = validateRequest(res, schemas.createApiKey, { body });
          if (!validated.ok) return;
          const keyInput = validated.data.body;
          const issued = await apiKeyService.issueKey({
            name: keyInput.name ?? "default",
            owner: keyInput.owner ?? (req.headers["x-actor"] || config.adminActor),
            scopes: keyInput.scopes ?? ["credentials:read"],
            tier: keyInput.tier ?? "free",
            expiresInDays: keyInput.expiresInDays ?? null,
          });

          await appendAuditLog(config, {
            action: "issue_api_key",
            actor: req.headers["x-actor"] ?? config.adminActor,
            keyId: issued.id,
            owner: issued.owner,
            scopes: issued.scopes,
            tier: issued.tier,
          });

          return sendJson(res, 201, issued);
        }

        if (req.method === "GET" && url.pathname === "/admin/api-keys") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const keys = await apiKeyService.listKeys();
          const page = cursorPage(keys, {
            limit: url.searchParams.get("limit"),
            cursor: url.searchParams.get("cursor"),
          });
          setPaginationHeaders(res, url, page.pagination);
          return sendJson(res, 200, {
            keys: page.items,
            nextCursor: page.nextCursor,
            previousCursor: page.previousCursor,
            pagination: page.pagination,
          });
        }

        const apiKeyIdMatch = url.pathname.match(/^\/admin\/api-keys\/([^/]+)$/);
        if (req.method === "GET" && apiKeyIdMatch) {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const id = decodeURIComponent(apiKeyIdMatch[1]);
          const keyMeta = await apiKeyService.getKey(id);
          if (!keyMeta) return notFound(res);
          return sendJson(res, 200, keyMeta);
        }

        if (req.method === "DELETE" && apiKeyIdMatch) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          const id = decodeURIComponent(apiKeyIdMatch[1]);
          const revoked = await apiKeyService.revokeKey(id);
          if (!revoked) return notFound(res);
          await appendAuditLog(config, {
            action: "revoke_api_key",
            actor: req.headers["x-actor"] ?? config.adminActor,
            keyId: id,
          });
          return sendJson(res, 200, { success: true, id, status: "revoked" });
        }

        const apiKeyRotateMatch = url.pathname.match(/^\/admin\/api-keys\/([^/]+)\/rotate$/);
        if (req.method === "POST" && apiKeyRotateMatch) {
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          const id = decodeURIComponent(apiKeyRotateMatch[1]);
          const body = await readJson(req, config);
          const validated = validateRequest(res, schemas.rotateApiKey, { body });
          if (!validated.ok) return;
          const rotated = await apiKeyService.rotateKey(id, {
            expiresInDays: validated.data.body.expiresInDays ?? null,
          });
          if (!rotated) return notFound(res);
          await appendAuditLog(config, {
            action: "rotate_api_key",
            actor: req.headers["x-actor"] ?? config.adminActor,
            keyId: id,
          });
          return sendJson(res, 200, rotated);
        }

        // ── Audit Log Query API (#720) ─────────────────────────────────
        // GET /admin/audit-logs — paginated query over daily NDJSON audit log files.
        // Query params: date (YYYY-MM-DD), action (string), limit (int), offset (int)
        if (req.method === "GET" && pathname === "/admin/audit-logs") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;

          const dateParam  = url.searchParams.get("date")   ?? null;
          const actionParam = url.searchParams.get("action") ?? null;
          const limit  = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit")  ?? "50",  10) || 50, 1), 500);
          const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

          try {
            const logDir = path.dirname(config.auditLogPath);
            const baseName = path.basename(config.auditLogPath);

            // Collect candidate log files
            let files;
            try {
              files = await fs.readdir(logDir);
            } catch (e) {
              if (e.code === 'ENOENT') files = [];
              else throw e;
            }

            const logPattern = new RegExp(`^${baseName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})\\.ndjson$`);
            let matchingFiles = files.filter((f) => {
              const m = f.match(logPattern);
              if (!m) return false;
              if (dateParam && m[1] !== dateParam) return false;
              return true;
            }).sort(); // ascending date order

            // Parse all matching entries
            const entries = [];
            for (const file of matchingFiles) {
              let raw;
              try {
                raw = await fs.readFile(path.join(logDir, file), 'utf8');
              } catch (e) {
                if (e.code === 'ENOENT') continue;
                throw e;
              }
              for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const entry = JSON.parse(trimmed);
                  if (actionParam && entry.action !== actionParam) continue;
                  entries.push(entry);
                } catch {
                  // skip malformed lines
                }
              }
            }

            const total = entries.length;
            const page = entries.slice(offset, offset + limit);
            const pagination = offsetMeta({ totalCount: total, pageSize: limit, offset });
            setPaginationHeaders(res, url, pagination);
            return sendJson(res, 200, { total, limit, offset, entries: page, pagination });
          } catch (err) {
            logger.error({ error: err.message, stack: err.stack }, 'Failed to read audit logs');
            return sendJson(res, 500, { error: 'audit_log_read_failed', message: err.message });
          }
        }

        // GET /admin/audit-logs/export — CSV export of audit log entries.
        // Supports the same query params as /admin/audit-logs (date, action).
        if (req.method === "GET" && pathname === "/admin/audit-logs/export") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;

          const dateParam   = url.searchParams.get("date")   ?? null;
          const actionParam = url.searchParams.get("action") ?? null;

          try {
            const logDir  = path.dirname(config.auditLogPath);
            const baseName = path.basename(config.auditLogPath);

            let files;
            try {
              files = await fs.readdir(logDir);
            } catch (e) {
              if (e.code === 'ENOENT') files = [];
              else throw e;
            }

            const logPattern = new RegExp(`^${baseName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})\\.ndjson$`);
            const matchingFiles = files.filter((f) => {
              const m = f.match(logPattern);
              if (!m) return false;
              if (dateParam && m[1] !== dateParam) return false;
              return true;
            }).sort();

            // Collect all field names across all entries to build CSV header dynamically
            const allEntries = [];
            for (const file of matchingFiles) {
              let raw;
              try {
                raw = await fs.readFile(path.join(logDir, file), 'utf8');
              } catch (e) {
                if (e.code === 'ENOENT') continue;
                throw e;
              }
              for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const entry = JSON.parse(trimmed);
                  if (actionParam && entry.action !== actionParam) continue;
                  allEntries.push(entry);
                } catch {
                  // skip malformed lines
                }
              }
            }

            // Derive CSV columns from the union of all entry keys
            const colSet = new Set();
            for (const e of allEntries) Object.keys(e).forEach((k) => colSet.add(k));
            const cols = ['timestamp', 'action', ...Array.from(colSet).filter((c) => c !== 'timestamp' && c !== 'action').sort()];

            const csvEscape = (v) => {
              if (v === null || v === undefined) return '';
              const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
            };

            const lines = [cols.join(',')];
            for (const e of allEntries) {
              lines.push(cols.map((c) => csvEscape(e[c])).join(','));
            }

            const csv = lines.join('\n');
            const exportDate = dateParam ?? new Date().toISOString().split('T')[0];
            res.writeHead(200, {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="audit-logs-${exportDate}.csv"`,
            });
            return res.end(csv);
          } catch (err) {
            logger.error({ error: err.message, stack: err.stack }, 'Failed to export audit logs');
            return sendJson(res, 500, { error: 'audit_log_export_failed', message: err.message });
          }
        }

        // Session key lifecycle (#1049): a client can inspect and drop the
        // keys it negotiated without going through the admin surface.
        if (req.method === "GET" && pathname === "/encryption/keys") {
          const keyId = req.headers[ENCRYPTION_KEY_ID_HEADER] ?? null;
          if (!keyId) {
            return sendJson(res, 400, {
              error: "missing_key_id",
              code: "MISSING_KEY_ID",
              message: `Provide the session key id in the ${ENCRYPTION_KEY_ID_HEADER} header.`,
            });
          }
          const key = encryptionKeys.describe(keyId);
          if (!key) {
            return sendJson(res, 404, {
              error: "unknown_key_id",
              code: "UNKNOWN_KEY_ID",
              message: "The supplied session key id is unknown or has expired.",
            });
          }
          return sendJson(res, 200, key);
        }

        if (req.method === "DELETE" && pathname === "/encryption/keys") {
          const keyId = req.headers[ENCRYPTION_KEY_ID_HEADER] ?? null;
          if (!keyId) {
            return sendJson(res, 400, {
              error: "missing_key_id",
              code: "MISSING_KEY_ID",
              message: `Provide the session key id in the ${ENCRYPTION_KEY_ID_HEADER} header.`,
            });
          }
          const revoked = encryptionKeys.revoke(keyId);
          if (!revoked) return notFound(res);
          return sendJson(res, 200, { revoked: true, keyId });
        }

        // Multi-tenant administration and provisioning endpoints (#800)
        if (handleTenantRoutes(req, res, url, tenantRegistry, (entry) => appendAuditLog(config, entry))) {
          return;
        }

        // Event sourcing audit trail routes (#802)
        if (handleEventSourcingRoutes(req, res, url, eventStore, eventReplayer)) {
          return;
        }

        return notFound(res);
    };
    return requestContextStore.run({ requestId, correlationId, tenantId }, handler).catch((error) => {
        if (error.name === "SorobanError" || error.name === "SorobanUnavailableError") {
          const isUnavailable = error.name === "SorobanUnavailableError" || error.category === "rpc_unavailable";
          const statusCode = isUnavailable ? 503 : 500;
          logger.error({ 
            error: error.category || "rpc_unavailable", 
            message: error.publicMessage || error.message,
            internalDetail: error.internalDetail || error.message 
          }, 'Soroban error occurred');
          return sendJson(res, statusCode, {
            error: error.category || "rpc_unavailable",
            message: error.publicMessage || error.message,
            ...(soroban?.circuitBreaker ? { circuitBreakerState: soroban.circuitBreaker.state } : {}),
          });
        }
        logger.error({ error: error.message, stack: error.stack }, 'Internal server error');
        return sendFormatted(req, res, 500, {
          error: "internal_server_error",
          message: error.message,
        });
    });
  };
}
