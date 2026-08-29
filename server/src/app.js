import { URL } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appendAuditLog, readCredentials, writeCredentials, createAndPersistCredential, revokeAndPersistCredential, DuplicateCredentialError } from "./storage.js";
import { findExpiringCredentials, paginate, paginateCursor } from "./expiry.js";
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
import { schemas, validateRequest } from "./validation.js";
import { routeLabel } from "./route-label.js";
import { requestContextStore } from "./request-context.js";
import { handleEventsRequest } from "./sse.js";
import { handleLongPollRequest } from "./long-poll.js";
import { logger } from "./logger.js";
import { AnalyticsService, detectCountry } from "./analytics.js";
import { TieredRateLimiter } from "./rate-limiter.js";
import { ApiKeyService } from "./api-keys.js";
import { EmailTransport } from "./email.js";
import { pickQuotaBinding, QuotaTracker, notifyQuotaThresholdOwner } from "./quota.js";
import { executeBatch } from "./batch.js";
import { DeprecationRegistry, notifyDeprecatedEndpointOwner } from "./deprecation.js";
import { DdosProtection, ddosResponse } from "./ddos-protection.js";
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
];

export function createApp({ config, soroban, metrics, metricsAggregator, analytics = new AnalyticsService() }) {
  return function app(req, res) {
    const startTime = Date.now();
export function createApp({
  config,
  soroban,
  metrics,
  metricsAggregator,
  didCache = null,
  // Health and readiness probes only need something that can answer PING;
  // the DID cache already owns a connected client, so reuse it unless a
  // caller (or a test) supplies one explicitly.
  redisClient = didCache?.client ?? null,
  webhookService = new WebhookDeliveryService(config),
  apiKeyService = new ApiKeyService(config),
  rateLimiter = null,
  accessLogSink = null,
  realtime = null,
  nonceStore = new NonceStore({ ttlSeconds: config.requestSigningMaxAgeSeconds }),
  vcSerializer = createVcSerializer(config, { logger }),
  emailTransport = new EmailTransport(config),
  quotaTracker = null,
  deprecationRegistry = null,
  ddosProtection = null,
}) {
  // Expose the key service on config so http-utils.requireAuth can validate
  // issued API keys instead of falling back to the single admin key.
  config.apiKeyService = apiKeyService;

  // One limiter per app instance, so its buckets live as long as the server
  // rather than being rebuilt per request.
  const limiter =
    rateLimiter ??
    new TieredRateLimiter({
      whitelist: config.rateLimitWhitelist ?? [],
      trustProxy: config.trustProxy ?? false,
      maxBuckets: config.rateLimitMaxBuckets ?? 10000,
    });

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

  return async function app(req, res) {
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

    // Check if this is the metrics endpoint before setting X-Request-ID
    const isMetricsEndpoint = req.method === "GET" && pathname === "/metrics";
    
    // Generate requestId for all endpoints except metrics
    const requestId = isMetricsEndpoint ? null : (req.headers["x-request-id"] || crypto.randomUUID());
    
    if (!isMetricsEndpoint) {
      res.setHeader("X-Request-ID", requestId);
    }

    // CSP and companion security headers (#754). Set before any branch that
    // can produce a response, so an early return still carries them. The
    // nonce is stashed on the request for the one HTML page we render.
    req.cspNonce = setSecurityHeaders(req, res, config);

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

    // Record analytics when response completes
    res.on("finish", () => {
      const durationMs = Math.max(0, Date.now() - startTime);
      const consumer =
        req.headers["x-api-key"] ||
        req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
        "anonymous";
      const country = detectCountry(req);

      analytics.recordRequest({
        method: req.method,
        path: url.pathname,
        statusCode: res.statusCode,
        durationMs,
        consumer,
        country,
      });
    });

    return requestContextStore.run({ requestId }, async () => {
      try {
        if (req.method === "GET" && url.pathname === "/info") {
          return sendFormatted(req, res, 200, {
    // Validate well-known request headers before any routing or auth work.
    if (!validateRequest(res, schemas.commonHeaders, { headers: req.headers }).ok) {
      return;
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

        const verdict = verifySignedRequest({
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
        res.setHeader("X-RateLimit-Bypass", "whitelist");
      } else {
        // Report whichever budget is closest to exhaustion, so a client sees
        // the limit that will actually stop it first.
        const reported = rateResult.binding ?? rateResult;
        res.setHeader("X-RateLimit-Tier", String(rateResult.tier ?? reported.rule ?? "free"));
        res.setHeader("X-RateLimit-Limit", String(reported.limit));
        res.setHeader("X-RateLimit-Remaining", String(reported.remaining));
        res.setHeader("X-RateLimit-Reset", String(reported.resetAt));
        if (rateResult.scope === "endpoint" || rateResult.endpoint?.rule) {
          res.setHeader("X-RateLimit-Scope", rateResult.scope === "endpoint" ? "endpoint" : "tier");
        }
      }

      if (!rateResult.allowed) {
        res.setHeader("Retry-After", String(rateResult.retryAfter));

        // An endpoint denial is not a tier problem, so it must not be dressed
        // up as one — upgrading would not raise a per-endpoint limit.
        const isEndpointDenial = rateResult.scope === "endpoint";

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

    // Quota check (#748): a separate budget from the rate limit above,
    // measured against calendar day/month boundaries rather than a rolling
    // window. GET /quota itself is exempt so checking your own usage never
    // consumes it.
    if (!isExempt && pathname !== "/quota") {
      const quotaResult = quota.consume(req);
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

    return requestContextStore.run({ requestId }, async () => {
      try {
        if (req.method === "GET" && pathname === "/info") {
          return sendJson(res, 200, {
            version: SERVER_VERSION,
            apiVersion: version,
            supportedVersions: SUPPORTED_VERSIONS,
            features: SERVER_FEATURES,
            minSdkVersion: MIN_SDK_VERSION,
          });
        }

        if (req.method === "GET" && url.pathname === "/health") {
          const contracts = await soroban.pingAllContracts();
          const ok = Object.values(contracts).every(Boolean);
          return sendFormatted(req, res, ok ? 200 : 503, {
            status: ok ? "ok" : "degraded",
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

        // #390: paginated credential list
        if (req.method === "GET" && url.pathname === "/credentials") {
          const limitParam = url.searchParams.get("limit") ?? "50";
          const limitNum = Number.parseInt(limitParam, 10) || 50;
          if (limitNum > 200) {
            return sendFormatted(req, res, 400, { code: "INVALID_REQUEST", message: "limit must not exceed 200" });
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


        // #390: paginated credential list
        if (req.method === "GET" && pathname === "/credentials") {
          const validated = validateRequest(res, schemas.listCredentials, {
            query: url.searchParams,
          });
          if (!validated.ok) return;
          const limitNum = validated.data.query.limit ?? 50;
          const credentials = await readCredentials(config);
          const { items, nextCursor } = paginateCursor(credentials, {
            limit: limitNum,
            cursor: validated.data.query.cursor ?? null,
          });
          return sendFormatted(req, res, 200, { items, nextCursor });

          if (wantsJsonLd(req, url)) {
            return sendJson(
              res,
              200,
              {
                items: items.map((item) => vcSerializer.serialize(item)),
                nextCursor,
              },
              { "content-type": "application/ld+json; charset=utf-8" },
            );
          }

          if (version === "v2") {
            return sendJson(res, 200, {
              apiVersion: "v2",
              data: {
                items,
                pageInfo: {
                  nextCursor,
                  hasNextPage: Boolean(nextCursor),
                  count: items.length,
                },
              },
              meta: {
                timestamp: new Date().toISOString(),
              },
            });
          }
          return sendJson(res, 200, { items, nextCursor });
        }

        // Single-item GET /credentials/:id
        const credentialIdMatch = pathname.match(/^\/credentials\/([^/]+)$/);
        if (req.method === "GET" && credentialIdMatch) {
          const credentialId = decodeURIComponent(credentialIdMatch[1]);
          if (!validateRequest(res, schemas.credentialByIdParams, { params: { credentialId } }).ok) {
            return;
          }
          const credentials = await readCredentials(config);
          const credential = credentials.find((c) => c.id === credentialId);
          if (!credential) return notFound(res, req);
          return sendFormatted(req, res, 200, credential);
          if (!credential) return notFound(res);

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

          if (version === "v2") {
            return sendJson(res, 200, {
              apiVersion: "v2",
              data: credential,
            });
          }
          return sendJson(res, 200, credential);
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
          const credentials = await readCredentials(config);
          const credential = credentials.find((c) => c.id === credentialId);
          if (!credential) return notFound(res);

          const status = credentialStatus(credential);
          return sendJson(res, 200, {
            id: `${pathname}`,
            type: CREDENTIAL_STATUS_TYPE,
            credentialId,
            ...status,
            checkedAt: new Date().toISOString(),
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
          const credentials = await readCredentials(config);
          const credential = credentials.find((c) => c.id === credentialId);
          const recordVerification = (result) =>
            metrics?.observeCredentialVerification?.(result);
          if (!credential) {
            return sendFormatted(req, res, 200, { verified: false, reason: "not_found" });
          }
          if (credential.revoked) {
            return sendFormatted(req, res, 200, { verified: false, reason: "revoked" });
          }
          const now = Math.floor(Date.now() / 1000);
          if (credential.expiresAt > 0 && credential.expiresAt < now) {
            return sendFormatted(req, res, 200, { verified: false, reason: "expired" });
          }
          return sendFormatted(req, res, 200, { verified: true, credential });
            recordVerification("not_found");
            return sendJson(res, 200, { verified: false, reason: "not_found" });
          }
          if (credential.revoked) {
            recordVerification("revoked");
            return sendJson(res, 200, { verified: false, reason: "revoked" });
          }
          const now = Math.floor(Date.now() / 1000);
          if (credential.expiresAt > 0 && credential.expiresAt < now) {
            recordVerification("expired");
            return sendJson(res, 200, { verified: false, reason: "expired" });
          }
          recordVerification("verified");
          return sendJson(res, 200, { verified: true, credential });
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

        if (
          pathname.startsWith("/admin/") &&
          !(await requireAdmin(req, res, config))
        )
          return;

        // Analytics Dashboard
        if (req.method === "GET" && url.pathname === "/admin/analytics/dashboard") {
          if (!requireAuth(req, res, config, ['admin:read'])) return;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(analytics.renderDashboardHtml());
        }

        // Analytics Export (CSV or JSON)
        if (req.method === "GET" && url.pathname === "/admin/analytics/export") {
          if (!requireAuth(req, res, config, ['admin:read'])) return;
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
          if (!requireAuth(req, res, config, ['admin:read'])) return;
          return sendFormatted(req, res, 200, analytics.getSummary());
        }

        if (req.method === "POST" && url.pathname === "/credentials") {
          if (!requireAuth(req, res, config, ['credentials:write'])) return;
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendFormatted(req, res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit." });
          if (!body.id)
            return sendFormatted(req, res, 400, { code: "INVALID_REQUEST", message: "Request body must include a credential id." });
          try {
            const updated = await createAndPersistCredential(config, body);
            await appendAuditLog(config, { action: "issue_credential", credentialId: body.id });
            return sendFormatted(req, res, 201, body);
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
            await createAndPersistCredential(config, credential);
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
            return sendJson(res, 201, credential);
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
          const revoked = await revokeAndPersistCredential(config, credentialId);
          if (!revoked) return notFound(res);
          await appendAuditLog(config, { action: "revoke_credential", credentialId });
          webhookService.trigger("credential.revoked", { id: credentialId, revokedAt: revoked.revokedAt }).catch(() => {});
          realtime?.emitCredentialEvent("revoked", revoked);
          return sendJson(res, 200, { revoked: true, credential: revoked });
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
          const webhooks = await readWebhooks(config);
          return sendJson(res, 200, { webhooks });
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
          const logs = await readWebhookLogs(config, { webhookId, limit });
          return sendJson(res, 200, { logs });
        }

        if (req.method === "GET" && pathname === "/notifications/logs") {
          if (!await requireAuth(req, res, config, ['admin:read'])) return;
          const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
          if (limit > 200) {
            return sendJson(res, 400, { code: "INVALID_REQUEST", message: "limit must not exceed 200" });
          }
          const logs = await readNotificationLog(config, {
            limit,
            credentialId: url.searchParams.get("credentialId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
          });
          return sendJson(res, 200, { logs });
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
          const logs = await readWebhookLogs(config, { webhookId, limit });
          return sendJson(res, 200, { logs });
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
          
          const issuers = await soroban.getIssuers();
          return sendFormatted(req, res, 200, { issuers });
        }

        if (req.method === "POST" && pathname === "/admin/issuers") {
          if (validateContentType(req, res)) return;
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendFormatted(req, res, 413, { error: "payload_too_large" });
          if (!body.issuer)
            return sendFormatted(req, res, 400, { error: "issuer_required" });
          await soroban.addIssuer(body.issuer);
            return sendJson(res, 413, { error: "payload_too_large" });
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
          return sendJson(res, 201, { issuer });
        }

        if (req.method === "DELETE" && pathname === "/admin/issuers") {
          // Removing issuers requires admin:write scope
          if (!await requireAuth(req, res, config, ['admin:write'])) return;
          
          const body = await readJson(req, config);
          if (body.__payloadTooLarge)
            return sendFormatted(req, res, 413, { error: "payload_too_large" });
          const issuer = body.issuer ?? url.searchParams.get("issuer");
          if (!issuer) return sendFormatted(req, res, 400, { error: "issuer_required" });
            return sendJson(res, 413, { error: "payload_too_large" });
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
          const credentials = await readCredentials(config);
          const expiring = findExpiringCredentials(credentials, {
            windowDays,
            includeNotified: true,
          });
          return sendFormatted(
            req,
            res,
            200,
            paginate(expiring, {
              page: validated.data.query.page ?? null,
              pageSize: validated.data.query.pageSize ?? null,
            }),
          );
        }

        return notFound(res, req);
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
          return sendJson(res, 200, { keys });
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
            return sendJson(res, 200, { total, limit, offset, entries: page });
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

        return notFound(res);
      } catch (error) {
        if (error.name === "SorobanError") {
          logger.error({ 
            error: error.category, 
            message: error.publicMessage,
            internalDetail: error.internalDetail 
          }, 'Soroban error occurred');
          return sendFormatted(req, res, 500, {
            error: error.category,
            message: error.publicMessage,
          });
        }
        logger.error({ error: error.message, stack: error.stack }, 'Internal server error');
        return sendFormatted(req, res, 500, {
          error: "internal_server_error",
          message: error.message,
        });
      }
    });
  };
}
