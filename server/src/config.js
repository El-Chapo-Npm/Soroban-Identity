import path from "node:path";
import { logger } from './logger.js';
import { parseCronExpression } from './cron.js';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
// Defaults used by the optional session-key encryption feature. The sensitive
// field list remains empty so deployments must opt in to fields explicitly.
const DEFAULT_ENCRYPTION_KEY_ROTATION_SECONDS = 900;
const DEFAULT_ENCRYPTION_SESSION_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_ENCRYPTION_SENSITIVE_FIELDS = [];

/**
 * Parse an integer from a string environment variable value.
 *
 * @param {string|undefined} value     - Raw env var string
 * @param {number}           fallback  - Default when value is absent or invalid
 * @param {boolean}         [allowZero=false] - When true, 0 is accepted as a
 *   valid "disabled" sentinel in addition to positive integers. Keys that
 *   support disable-via-0 (EVENT_POLL_INTERVAL_MS, RPC_MAX_RETRIES,
 *   SOROBAN_POOL_SIZE) must pass allowZero: true. All other keys require a
 *   strictly positive integer.
 */
function parseInteger(value, fallback, allowZero = false) {
  const parsed = Number.parseInt(value ?? "", 10);
  const isValid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  return isValid ? parsed : fallback;
}

/**
 * Resolve the Stellar source account from environment variables.
 * STELLAR_SOURCE_ACCOUNT takes precedence over STELLAR_SECRET_KEY.
 * Both loadConfig and validateConfig use this helper so they always agree
 * on which variable is authoritative when both are set.
 *
 * @param {Object} env - Environment variable object
 * @returns {string} The resolved source account, or "" if neither is set
 */
function resolveSourceAccount(env) {
  return env.STELLAR_SOURCE_ACCOUNT ?? env.STELLAR_SECRET_KEY ?? "";
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON configuration: ${error.message}`);
  }
}

/**
 * Parse the allowed CORS origins.
 *
 * Accepts a comma-separated list, a single origin, or `*`. `CORS_ORIGIN` is
 * the documented name; `CORS_ALLOWED_ORIGINS` is still read as an alias so
 * existing deployments keep working.
 *
 * Default: allow all in development, none in production — a production
 * deployment must name its origins explicitly rather than inheriting a
 * permissive default.
 *
 * @param {string|undefined} value
 * @param {string} nodeEnv
 * @returns {string[]}
 */
function parseCorsOrigins(value, nodeEnv) {
  if (!value) {
    return nodeEnv === "development" ? ["*"] : [];
  }
  if (value.trim() === "*") {
    return ["*"];
  }
  // Comma-separated list of origins
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Parse a boolean environment variable.
 *
 * Accepts true/1/yes/on and false/0/no/off, case-insensitively. Anything else
 * (including an empty value) falls back to the default rather than being
 * silently treated as false.
 *
 * @param {string|undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse a comma-separated list into a trimmed array, falling back to a default
 * when the variable is unset or contains only separators.
 *
 * @param {string|undefined} value
 * @param {string[]} fallback
 * @returns {string[]}
 */
function parseList(value, fallback) {
  if (!value) return fallback;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export const DEFAULT_CORS_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export const DEFAULT_CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-API-Key",
  "X-Request-ID",
  "X-Correlation-ID",
  "X-Actor",
  "X-User-Tier",
  "X-API-Version",
];

export const DEFAULT_CORS_EXPOSED_HEADERS = [
  "X-Request-ID",
  "X-Correlation-ID",
  "Content-Type",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "X-API-Version",
];

/** Preflight cache lifetime in seconds. Browsers cap this themselves. */
export const DEFAULT_CORS_MAX_AGE = 86400;

/**
 * Parse the geo-distributed read replica topology (#1051).
 *
 * Accepts a JSON object mapping region names to replica endpoints, e.g.
 * `{"us":"https://us.db.example.com","eu":"https://eu.db.example.com"}`.
 * A plain comma-separated list of `region=url` pairs is also accepted so the
 * value stays readable in a shell. Invalid entries are dropped rather than
 * throwing, so one malformed region cannot take down the whole server.
 *
 * @param {string|undefined} value
 * @returns {Object<string,string>} region (lowercased) -> endpoint URL
 */
function parseReplicaEndpoints(value) {
  if (!value) return {};
  const endpoints = {};
  const trimmed = String(value).trim();
  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSON configuration: ${error.message}`);
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [region, url] of Object.entries(parsed)) {
        if (typeof url === "string" && url.trim()) {
          endpoints[region.trim().toLowerCase()] = url.trim();
        }
      }
    }
    return endpoints;
  }
  for (const pair of trimmed.split(",")) {
    const [region, ...rest] = pair.split("=");
    const url = rest.join("=").trim();
    if (region && region.trim() && url) {
      endpoints[region.trim().toLowerCase()] = url;
    }
  }
  return endpoints;
}

/**
 * Parse the region -> nearest-replica routing table (#1051).
 *
 * Accepts a JSON object or `region=replicaRegion` pairs, e.g.
 * `{"us-east-1":"us","eu-west-1":"eu"}`. Keys are lowercased so lookups can
 * be case-insensitive.
 *
 * @param {string|undefined} value
 * @returns {Object<string,string>}
 */
function parseRegionRouting(value) {
  if (!value) return {};
  const routing = {};
  const trimmed = String(value).trim();
  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSON configuration: ${error.message}`);
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [region, replica] of Object.entries(parsed)) {
        if (typeof replica === "string" && replica.trim()) {
          routing[region.trim().toLowerCase()] = replica.trim().toLowerCase();
        }
      }
    }
    return routing;
  }
  for (const pair of trimmed.split(",")) {
    const [region, ...rest] = pair.split("=");
    const replica = rest.join("=").trim();
    if (region && region.trim() && replica) {
      routing[region.trim().toLowerCase()] = replica.toLowerCase();
    }
  }
  return routing;
}

function parseThresholds(value, fallback = [30, 7, 1]) {
  if (!value) return fallback;
  try {
    if (typeof value === "string") {
      const parsed = value
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      return parsed.length > 0 ? parsed.sort((a, b) => b - a) : fallback;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    // The deterministic mock API is opt-in and never enabled in production.
    mockApiEnabled: nodeEnv !== "production" && parseBoolean(env.MOCK_API_ENABLED, false),
    port: parseInteger(env.PORT, 3001),
    adminApiKey: env.ADMIN_API_KEY ?? "",
    adminIpAllowlist: parseList(env.ADMIN_IP_ALLOWLIST, []),
    // Production admin routes are unavailable until an explicit allowlist is
    // supplied. Set ADMIN_IP_ALLOWLIST_REQUIRED=false only for a deliberate
    // migration window; a configured list is always enforced.
    adminIpAllowlistRequired: parseBoolean(
      env.ADMIN_IP_ALLOWLIST_REQUIRED,
      nodeEnv === "production",
    ),
    adminActor: env.ADMIN_ACTOR ?? "admin",
    corsAllowedOrigins: parseCorsOrigins(
      env.CORS_ORIGIN ?? env.CORS_ALLOWED_ORIGINS,
      nodeEnv,
    ),
    corsCredentials: parseBoolean(env.CORS_CREDENTIALS, false),
    corsMethods: parseList(env.CORS_METHODS, DEFAULT_CORS_METHODS),
    corsAllowedHeaders: parseList(
      env.CORS_ALLOWED_HEADERS,
      DEFAULT_CORS_ALLOWED_HEADERS,
    ),
    corsExposedHeaders: parseList(
      env.CORS_EXPOSED_HEADERS,
      DEFAULT_CORS_EXPOSED_HEADERS,
    ),
    corsMaxAge: parseInteger(env.CORS_MAX_AGE, DEFAULT_CORS_MAX_AGE, true),
    maxBodyBytes: parseInteger(env.MAX_BODY_BYTES, 64 * 1024),
    // End-to-end encryption of sensitive credential data in transit (#1049).
    // Off by default: enabling it changes the response shape for the fields
    // listed in ENCRYPTION_SENSITIVE_FIELDS, so clients must be updated to
    // decrypt before this is switched on.
    encryptionEnabled: parseBoolean(env.ENCRYPTION_ENABLED, false),
    // Session keys are rotated on this interval; must be shorter than the
    // session TTL so a client always has a window in which its key is valid.
    encryptionKeyRotationSeconds: parseInteger(
      env.ENCRYPTION_KEY_ROTATION_SECONDS,
      DEFAULT_ENCRYPTION_KEY_ROTATION_SECONDS,
    ),
    encryptionSessionTtlSeconds: parseInteger(
      env.ENCRYPTION_SESSION_TTL_SECONDS,
      DEFAULT_ENCRYPTION_SESSION_TTL_SECONDS,
    ),
    encryptionSensitiveFields: parseList(
      env.ENCRYPTION_SENSITIVE_FIELDS,
      DEFAULT_ENCRYPTION_SENSITIVE_FIELDS,
    ),
    // HMAC request signing (#752). Off by default: turning it on is a
    // breaking change for existing clients, which must be given their signing
    // secrets before their requests start being rejected.
    requestSigningEnabled: parseBoolean(env.REQUEST_SIGNING_ENABLED, false),
    // "mutations" signs POST/PUT/PATCH/DELETE only, which is where replay
    // actually causes damage; "all" additionally covers reads.
    requestSigningEnforce:
      (env.REQUEST_SIGNING_ENFORCE ?? "mutations").toLowerCase() === "all" ? "all" : "mutations",
    requestSigningMaxAgeSeconds: parseInteger(env.REQUEST_SIGNING_MAX_AGE_SECONDS, 300),
    // Nonce-based replay prevention (#1052). Off by default for the same
    // reason as request signing: enabling it rejects requests from clients
    // that do not yet send a nonce.
    requestNonceEnabled: parseBoolean(env.REQUEST_NONCE_ENABLED, false),
    // How long a used nonce is remembered in Redis. Falls back to the signing
    // max-age so the two windows stay aligned unless set explicitly.
    requestNonceTtlSeconds: parseInteger(
      env.REQUEST_NONCE_TTL_SECONDS ?? env.REQUEST_SIGNING_MAX_AGE_SECONDS,
      300,
    ),
    // Response header carrying the server-issued nonce for the next request.
    requestNonceHeader: env.REQUEST_NONCE_HEADER ?? "X-Nonce",
    // Content Security Policy (#754). Report-only by default: an enforced
    // policy that is even slightly too tight breaks the page, so a deployment
    // should watch reports first and switch to enforcing once they are clean.
    cspEnabled: parseBoolean(env.CSP_ENABLED, true),
    cspReportOnly: parseBoolean(env.CSP_REPORT_ONLY, true),
    cspReportUri: env.CSP_REPORT_URI ?? "/csp-report",
    // Extra trusted sources merged into the baseline directives. Each is a
    // comma-separated list of origins, e.g. "https://cdn.example.org".
    cspScriptSrc: parseList(env.CSP_SCRIPT_SRC, []),
    cspStyleSrc: parseList(env.CSP_STYLE_SRC, []),
    cspConnectSrc: parseList(env.CSP_CONNECT_SRC, []),
    cspImgSrc: parseList(env.CSP_IMG_SRC, []),
    cspFontSrc: parseList(env.CSP_FONT_SRC, []),
    cspFormAction: parseList(env.CSP_FORM_ACTION, []),
    cspFrameAncestors: parseList(env.CSP_FRAME_ANCESTORS, []),
    // W3C Verifiable Credentials JSON-LD (#753).
    // Base context: the v1.1 data model by default; set to the v2 URI to emit
    // v2 credentials (which renames issuanceDate/expirationDate).
    vcBaseContext:
      env.VC_BASE_CONTEXT ?? "https://www.w3.org/2018/credentials/v1",
    // Additional contexts appended to every credential, for a deployment with
    // its own vocabulary.
    vcExtraContexts: parseList(env.VC_EXTRA_CONTEXTS, []),
    // Public base URL. When set, credential and status ids are resolvable
    // https URLs instead of urn: identifiers.
    vcBaseUrl: env.VC_BASE_URL ?? "",
    // 32-byte Ed25519 seed (hex or base64) used to sign credentials. Without
    // it credentials are emitted unsigned rather than carrying a fake proof.
    vcProofPrivateKey: env.VC_PROOF_PRIVATE_KEY ?? "",
    // Defaults to "<issuer DID>#key-1" when unset.
    vcProofVerificationMethod: env.VC_PROOF_VERIFICATION_METHOD ?? "",
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : DEFAULT_DATA_DIR,
    auditLogPath: env.AUDIT_LOG_PATH
      ? path.resolve(env.AUDIT_LOG_PATH)
      : path.join(DEFAULT_DATA_DIR, "audit"),
    auditLogRetentionDays: parseInteger(env.AUDIT_LOG_RETENTION_DAYS, 30),
    credentialStorePath: env.CREDENTIAL_STORE_PATH
      ? path.resolve(env.CREDENTIAL_STORE_PATH)
      : path.join(DEFAULT_DATA_DIR, "credentials.json"),
    rateLimitWhitelist: (env.RATE_LIMIT_WHITELIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    rateLimitMaxBuckets: parseInteger(env.RATE_LIMIT_MAX_BUCKETS, 10000),
    // #956: per-IP and per-user token buckets, plus premium bypass.
    rateLimitIpPerMinute: parseInteger(env.RATE_LIMIT_IP_PER_MINUTE, 300),
    rateLimitIpBurst: parseInteger(env.RATE_LIMIT_IP_BURST, 60),
    rateLimitUserPerMinute: parseInteger(env.RATE_LIMIT_USER_PER_MINUTE, 600),
    rateLimitUserBurst: parseInteger(env.RATE_LIMIT_USER_BURST, 120),
    rateLimitPremiumTiers: (env.RATE_LIMIT_PREMIUM_TIERS ?? "premium,enterprise")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    rateLimitPremiumKeys: (env.RATE_LIMIT_PREMIUM_KEYS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === "true",
    ddosProtectionEnabled: parseBoolean(env.DDOS_PROTECTION_ENABLED, false),
    ddosWindowMs: parseInteger(env.DDOS_WINDOW_MS, 60_000),
    ddosMaxRequestsPerIp: parseInteger(env.DDOS_MAX_REQUESTS_PER_IP, 120),
    ddosMaxConnectionsPerIp: parseInteger(env.DDOS_MAX_CONNECTIONS_PER_IP, 20),
    ddosSuspiciousThreshold: parseInteger(env.DDOS_SUSPICIOUS_THRESHOLD, 96),
    ddosCaptchaEnabled: parseBoolean(env.DDOS_CAPTCHA_ENABLED, false),
    ddosCaptchaSecret: env.DDOS_CAPTCHA_SECRET ?? "",
    ddosCaptchaUrl: env.DDOS_CAPTCHA_URL ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    ddosBlockedRegions: parseList(env.DDOS_BLOCKED_REGIONS, []),
    redisUrl: env.REDIS_URL ?? "",
    didCacheTtlMs: parseInteger(env.DID_CACHE_TTL_MS, 60 * 1000),
    redisMaxRetries: parseInteger(env.REDIS_MAX_RETRIES, 5),
    redisRetryBaseMs: parseInteger(env.REDIS_RETRY_BASE_MS, 200),
    redisCommandTimeoutMs: parseInteger(env.REDIS_COMMAND_TIMEOUT_MS, 1000),
    redisEnableAutoReconnect: env.REDIS_ENABLE_AUTO_RECONNECT !== "false",
    redisReconnectDelayMs: parseInteger(env.REDIS_RECONNECT_DELAY_MS, 1000),
    cacheFailureThreshold: parseInteger(env.CACHE_FAILURE_THRESHOLD, 3),
    didCacheWarmList: (env.DID_CACHE_WARM_LIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    // Multi-layer caching strategy (#1118).
    // L1: in-process LRU cache. CACHE_L1_MAX_ENTRIES=0 disables L1.
    cacheL1Enabled: parseBoolean(env.CACHE_L1_ENABLED, true),
    cacheL1MaxEntries: parseInteger(env.CACHE_L1_MAX_ENTRIES, 1000, true),
    cacheL1DefaultTtlMs: parseInteger(env.CACHE_L1_DEFAULT_TTL_MS, 30_000),
    // L2: Redis-backed shared cache. TTLs are per data type so volatile data
    // (e.g. balances) is not held as long as stable data (e.g. DIDs).
    cacheL2Enabled: parseBoolean(env.CACHE_L2_ENABLED, true),
    cacheL2KeyPrefix: env.CACHE_L2_KEY_PREFIX ?? "cache:",
    cacheL2TtlDefaultMs: parseInteger(env.CACHE_L2_TTL_DEFAULT_MS, 60_000),
    cacheL2TtlDidMs: parseInteger(env.CACHE_L2_TTL_DID_MS, 60_000),
    cacheL2TtlCredentialMs: parseInteger(env.CACHE_L2_TTL_CREDENTIAL_MS, 30_000),
    cacheL2TtlVerificationMs: parseInteger(env.CACHE_L2_TTL_VERIFICATION_MS, 10_000),
    cacheL2TtlApiResponseMs: parseInteger(env.CACHE_L2_TTL_API_RESPONSE_MS, 5_000),
    cacheL2TtlSessionMs: parseInteger(env.CACHE_L2_TTL_SESSION_MS, 300_000),
    cacheL2TtlAnalyticsMs: parseInteger(env.CACHE_L2_TTL_ANALYTICS_MS, 600_000),
    // L3: CDN. Purging is opt-in; without a purge URL the CDN is assumed to
    // expire entries on its own TTL.
    cacheL3Enabled: parseBoolean(env.CACHE_L3_ENABLED, false),
    cacheL3PurgeUrl: env.CACHE_L3_PURGE_URL ?? "",
    cacheL3PurgeToken: env.CACHE_L3_PURGE_TOKEN ?? "",
    cacheL3PurgeTimeoutMs: parseInteger(env.CACHE_L3_PURGE_TIMEOUT_MS, 5000),
    // Cache warming: a cron schedule (empty disables) plus the list of keys
    // to preload on startup and on each scheduled run.
    cacheWarmEnabled: parseBoolean(env.CACHE_WARM_ENABLED, false),
    cacheWarmCronSchedule: env.CACHE_WARM_CRON_SCHEDULE ?? "",
    cacheWarmKeys: parseList(env.CACHE_WARM_KEYS, []),
    cacheWarmOnStartup: parseBoolean(env.CACHE_WARM_ON_STARTUP, true),
    // Stampede prevention: a per-key lock so only one caller recomputes a
    // missing entry while the rest wait (or serve stale) instead of all
    // hammering the origin at once.
    cacheStampedeLockTtlMs: parseInteger(env.CACHE_STAMPEDE_LOCK_TTL_MS, 5000),
    cacheStampedeWaitTimeoutMs: parseInteger(env.CACHE_STAMPEDE_WAIT_TIMEOUT_MS, 2000),
    cacheStampedeServeStale: parseBoolean(env.CACHE_STAMPEDE_SERVE_STALE, true),
    // Hit-rate monitoring: per-layer counters exposed on the metrics endpoint.
    cacheMetricsEnabled: parseBoolean(env.CACHE_METRICS_ENABLED, true),
    cacheMetricsLogIntervalMs: parseInteger(
      env.CACHE_METRICS_LOG_INTERVAL_MS,
      60_000,
      true,
    ),
    // API usage metering and billing (#1119).
    meteringEnabled: parseBoolean(env.METERING_ENABLED, false),
    // Where usage records are persisted (JSONL append log).
    usageStoragePath: env.USAGE_STORAGE_PATH
      ? path.resolve(env.USAGE_STORAGE_PATH)
      : path.join(DEFAULT_DATA_DIR, "usage"),
    // Tier definitions: name -> monthly included calls and per-call overage
    // price in cents. Overridable as JSON so pricing can change without a
    // deploy; the defaults mirror the documented Free/Pro/Enterprise tiers.
    billingTiers: parseJson(env.BILLING_TIERS, {
      free: { monthlyCalls: 1000, overageCentsPerCall: 0, custom: false },
      pro: { monthlyCalls: 50000, overageCentsPerCall: 1, custom: false },
      enterprise: { monthlyCalls: 0, overageCentsPerCall: 0, custom: true },
    }),
    billingDefaultTier: (env.BILLING_DEFAULT_TIER ?? "free").trim().toLowerCase(),
    // Stripe integration. Without a secret key invoices are generated but
    // never charged, so a deployment can meter usage before billing is live.
    stripeApiKey: env.STRIPE_API_KEY ?? "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    stripeApiBaseUrl: env.STRIPE_API_BASE_URL ?? "https://api.stripe.com",
    stripeTimeoutMs: parseInteger(env.STRIPE_TIMEOUT_MS, 10_000),
    // Monthly invoice generation. Empty schedule falls back to the 1st of the
    // month at midnight.
    invoiceCronSchedule: env.INVOICE_CRON_SCHEDULE ?? "0 0 1 * *",
    invoiceCurrency: (env.INVOICE_CURRENCY ?? "usd").trim().toLowerCase(),
    // Overage alerts: warn once usage crosses these percentages of the
    // tier's included quota.
    usageAlertThresholds: parseThresholds(env.USAGE_ALERT_THRESHOLDS, [80, 100]),
    usageAlertWebhookUrl: env.USAGE_ALERT_WEBHOOK_URL ?? "",
    // Usage-based discounts: percentage off the overage charge once a
    // customer's monthly call volume reaches the given threshold.
    usageDiscountTiers: parseJson(env.USAGE_DISCOUNT_TIERS, []),
    healthProbeTimeoutMs: parseInteger(env.HEALTH_PROBE_TIMEOUT_MS, 2000),
    redisUrl: env.REDIS_URL ?? "",
    accessLogEnabled: env.ACCESS_LOG_ENABLED !== "false",
    accessLogPath: env.ACCESS_LOG_PATH ?? "",
    accessLogMaxBytes: parseInteger(env.ACCESS_LOG_MAX_BYTES, 10 * 1024 * 1024),
    accessLogMaxFiles: parseInteger(env.ACCESS_LOG_MAX_FILES, 5),
    logPayloads: env.LOG_PAYLOADS === "true",
    logHeaders: env.LOG_HEADERS === "true",
    logPayloadMaxBytes: parseInteger(env.LOG_PAYLOAD_MAX_BYTES, 2048),
    trustProxy: env.TRUST_PROXY === "true",
    expiryWarningDays: parseInteger(env.EXPIRY_WARNING_DAYS, 7),
    expiryReminderThresholds: parseThresholds(
      env.EXPIRY_REMINDER_THRESHOLDS,
      [30, 7, 1],
    ),
    expiryJobIntervalMs: parseInteger(
      env.EXPIRY_JOB_INTERVAL_MS,
      60 * 60 * 1000,
    ),
    expiryConcurrency: parseInteger(env.EXPIRY_CONCURRENCY, 8),
    expiryCronSchedule: env.EXPIRY_CRON_SCHEDULE ?? "",
    notificationWebhookUrl: env.NOTIFICATION_WEBHOOK_URL ?? "",
    subjectNotificationWebhooks: parseJson(
      env.SUBJECT_NOTIFICATION_WEBHOOKS,
      {},
    ),
    emailApiUrl: env.EMAIL_API_URL ?? "",
    emailApiKey: env.EMAIL_API_KEY ?? "",
    emailFrom: env.EMAIL_FROM ?? "",
    notificationEmail: env.NOTIFICATION_EMAIL ?? "",
    subjectNotificationEmails: parseJson(env.SUBJECT_NOTIFICATION_EMAILS, {}),
    notificationMaxRetries: parseInteger(env.NOTIFICATION_MAX_RETRIES, 3),
    notificationRetryBaseMs: parseInteger(env.NOTIFICATION_RETRY_BASE_MS, 500),
    // SOROBAN_POOL_SIZE=0 disables the pool (allowZero: true)
    poolSize: parseInteger(env.SOROBAN_POOL_SIZE, 4, true),
    sorobanInvokeTimeoutMs: parseInteger(env.SOROBAN_INVOKE_TIMEOUT_MS, 10000),
    stellarCli: env.STELLAR_CLI ?? "stellar",
    sourceAccount: resolveSourceAccount(env),
    network: env.STELLAR_NETWORK ?? "testnet",
    rpcUrl: env.STELLAR_RPC_URL ?? env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    rpcCacheTtlMs: parseInteger(env.RPC_CACHE_TTL_MS, 5000),
    queryCacheEnabled: parseBoolean(env.QUERY_CACHE_ENABLED, true),
    queryCacheDefaultTtlMs: parseInteger(env.QUERY_CACHE_DEFAULT_TTL_MS, 5000),
    queryCacheTtlVolatileMs: parseInteger(env.QUERY_CACHE_TTL_VOLATILE_MS, 1000),
    queryCacheTtlStableMs: parseInteger(env.QUERY_CACHE_TTL_STABLE_MS, 60_000),
    queryCacheWarmQueries: parseJson(env.QUERY_CACHE_WARM_QUERIES, []),
    // RPC_MAX_RETRIES=0 disables retries (allowZero: true)
    rpcMaxRetries: parseInteger(env.RPC_MAX_RETRIES, 3, true),
    rpcRetryBaseMs: parseInteger(env.RPC_RETRY_BASE_MS, 500),
    rpcRetryBackoff: parseInteger(env.RPC_RETRY_BACKOFF, 2),
    // Circuit breaker configuration (#715)
    circuitBreakerFailureThreshold: parseInteger(env.CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5),
    circuitBreakerSuccessThreshold: parseInteger(env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD, 2),
    circuitBreakerOpenDurationMs: parseInteger(env.CIRCUIT_BREAKER_OPEN_DURATION_MS, 30_000),
    circuitBreakerTimeoutMs: parseInteger(env.CIRCUIT_BREAKER_TIMEOUT_MS, 10_000, true),
    circuitBreakerEnabled: parseBoolean(env.CIRCUIT_BREAKER_ENABLED, true),
    // EVENT_POLL_INTERVAL_MS=0 disables the event poller (allowZero: true)
    eventPollIntervalMs: parseInteger(env.EVENT_POLL_INTERVAL_MS, 5000, true),
    // #750: GET /events/poll long-polling. Timeout is clamped to
    // [1s, longPollMaxTimeoutMs] regardless of what a caller requests.
    longPollDefaultTimeoutMs: parseInteger(env.LONG_POLL_DEFAULT_TIMEOUT_MS, 30_000),
    longPollMaxTimeoutMs: parseInteger(env.LONG_POLL_MAX_TIMEOUT_MS, 60_000),
    // #748: whether a request over its daily/monthly quota is rejected
    // ("block") or let through flagged as overage ("allow").
    quotaOverageMode: (env.QUOTA_OVERAGE_MODE ?? "block").toLowerCase() === "allow" ? "allow" : "block",
    // WS_ENABLED=false turns the WebSocket endpoint off entirely
    wsEnabled: (env.WS_ENABLED ?? "true").toLowerCase() !== "false",
    wsPath: env.WS_PATH ?? "/ws",
    wsMessageLimit: parseInteger(env.WS_MESSAGE_LIMIT, 60),
    wsMessageWindowMs: parseInteger(env.WS_MESSAGE_WINDOW_MS, 60_000),
    // WS_HEARTBEAT_INTERVAL_MS=0 disables heartbeats (allowZero: true)
    wsHeartbeatIntervalMs: parseInteger(env.WS_HEARTBEAT_INTERVAL_MS, 30_000, true),
    // Response compression (#721)
    compressionEnabled: parseBoolean(env.COMPRESSION_ENABLED, true),
    compressionThreshold: parseInteger(env.COMPRESSION_THRESHOLD, 1024),
    compressionGzipLevel: parseInteger(env.COMPRESSION_GZIP_LEVEL, 6),
    compressionBrotliLevel: parseInteger(env.COMPRESSION_BROTLI_LEVEL, 4),
    compressionEnableBrotli: parseBoolean(env.COMPRESSION_ENABLE_BROTLI, true),
    // Graceful shutdown (#722)
    shutdownTimeoutMs: parseInteger(env.SHUTDOWN_TIMEOUT_MS, 30000),
    // Database connection pooling (#718)
    dbPoolMinSize: parseInteger(env.DB_POOL_MIN_SIZE, 2),
    dbPoolMaxSize: parseInteger(env.DB_POOL_MAX_SIZE, 10),
    dbPoolConnectionTimeoutMs: parseInteger(env.DB_POOL_CONNECTION_TIMEOUT_MS, 5000),
    dbPoolIdleTimeoutMs: parseInteger(env.DB_POOL_IDLE_TIMEOUT_MS, 30000),
    dbPoolMaxConnectionAgeMs: parseInteger(env.DB_POOL_MAX_CONNECTION_AGE_MS, 3600000),
    dbPoolHealthCheckIntervalMs: parseInteger(env.DB_POOL_HEALTH_CHECK_INTERVAL_MS, 30000),
    // Job queue for async processing (#716)
    jobQueueEnabled: parseBoolean(env.JOB_QUEUE_ENABLED, true),
    jobQueueConcurrency: parseInteger(env.JOB_QUEUE_CONCURRENCY, 4),
    jobQueueMaxRetries: parseInteger(env.JOB_QUEUE_MAX_RETRIES, 3),
    jobQueueRetryBackoffMs: parseInteger(env.JOB_QUEUE_RETRY_BACKOFF_MS, 1000),
    jobQueueProcessingTimeoutMs: parseInteger(env.JOB_QUEUE_PROCESSING_TIMEOUT_MS, 30000),
    credentialIssueQueueEnabled: parseBoolean(env.CREDENTIAL_ISSUE_QUEUE_ENABLED, true),
    batchVerificationQueueEnabled: parseBoolean(env.BATCH_VERIFICATION_QUEUE_ENABLED, true),
    contracts: {
      identity: env.IDENTITY_REGISTRY_ID ?? "",
      credential: env.CREDENTIAL_CONTRACT_ID ?? env.CREDENTIAL_MANAGER_ID ?? "",
      reputation: env.REPUTATION_ID ?? "",
    },
    // Geo-distributed read replicas (#1051). Replicas are opt-in: with no
    // endpoints configured every query goes to the primary, so an existing
    // single-region deployment is unaffected.
    readReplicasEnabled: parseBoolean(env.READ_REPLICAS_ENABLED, false),
    // Region -> replica endpoint, e.g. {"us":"https://us.db.example.com"}.
    replicaEndpoints: parseReplicaEndpoints(env.REPLICA_ENDPOINTS),
    // Region -> nearest replica region, e.g. {"us-east-1":"us"}.
    replicaRegionRouting: parseRegionRouting(env.REPLICA_REGION_ROUTING),
    // Region this instance runs in; used as the routing fallback.
    replicaLocalRegion: (env.REPLICA_LOCAL_REGION ?? "").trim().toLowerCase(),
    // Replica lag above this (ms) takes the replica out of rotation.
    replicaMaxLagMs: parseInteger(env.REPLICA_MAX_LAG_MS, 5000),
    // Lag above this (ms) is logged as a warning but still serves reads.
    replicaWarnLagMs: parseInteger(env.REPLICA_WARN_LAG_MS, 1000),
    // How often replica lag is sampled (0 disables the monitor).
    replicaLagCheckIntervalMs: parseInteger(
      env.REPLICA_LAG_CHECK_INTERVAL_MS,
      10_000,
      true,
    ),
    // Consecutive failed health checks before a replica is marked down.
    replicaFailureThreshold: parseInteger(env.REPLICA_FAILURE_THRESHOLD, 3),
    // Consecutive successful checks before a down replica is restored.
    replicaRecoveryThreshold: parseInteger(env.REPLICA_RECOVERY_THRESHOLD, 2),
    // When true, reads fall back to the primary if every replica is unhealthy.
    replicaFailoverToPrimary: parseBoolean(env.REPLICA_FAILOVER_TO_PRIMARY, true),
    // When true, a read that must observe its own write is sent to the primary
    // instead of a possibly-stale replica.
    replicaReadAfterWriteConsistency: parseBoolean(
      env.REPLICA_READ_AFTER_WRITE_CONSISTENCY,
      true,
    ),
    // Window (ms) after a write during which reads are pinned to the primary.
    replicaConsistencyWindowMs: parseInteger(
      env.REPLICA_CONSISTENCY_WINDOW_MS,
      2000,
    ),
    // Jaeger distributed tracing (#714)
    jaegerEnabled: parseBoolean(env.JAEGER_ENABLED, false),
    jaegerServiceName: env.JAEGER_SERVICE_NAME ?? "soroban-identity-server",
    jaegerAgentHost: env.JAEGER_AGENT_HOST ?? "localhost",
    jaegerAgentPort: parseInteger(env.JAEGER_AGENT_PORT, 6832),
    jaegerSamplerType: env.JAEGER_SAMPLER_TYPE ?? "const",
    jaegerSamplerParam: parseFloat(env.JAEGER_SAMPLER_PARAM ?? "1"),
    jaegerReporterLogSpans: parseBoolean(env.JAEGER_REPORTER_LOG_SPANS, false),
    jaegerReporterFlushInterval: parseInteger(env.JAEGER_REPORTER_FLUSH_INTERVAL, 1000),
  };
}

export function validateConfig(env = process.env) {
  const missing = [];
  const invalid = [];

  const sourceAccount = resolveSourceAccount(env);
  if (!sourceAccount) {
    missing.push("STELLAR_SECRET_KEY: Stellar account secret key (S…)");
  } else {
    if (!/^S[A-Z2-7]{55}$/.test(sourceAccount)) {
      invalid.push(
        "STELLAR_SECRET_KEY: Stellar account secret key must start with S and be 56 characters long",
      );
    }
  }

  const credentialContract =
    env.CREDENTIAL_CONTRACT_ID ?? env.CREDENTIAL_MANAGER_ID;
  if (!credentialContract) {
    missing.push(
      "CREDENTIAL_CONTRACT_ID: deployed credential contract address",
    );
  } else {
    if (!/^C[A-Z2-7]{55}$/.test(credentialContract)) {
      invalid.push(
        "CREDENTIAL_CONTRACT_ID: deployed credential contract address must start with C and be 56 characters long",
      );
    }
  }

  const numericVars = [
    { key: "PORT", desc: "must be a valid integer" },
    { key: "EXPIRY_WARNING_DAYS", desc: "must be a valid integer" },
    { key: "EXPIRY_JOB_INTERVAL_MS", desc: "must be a valid integer" },
    { key: "EXPIRY_CONCURRENCY", desc: "must be a valid integer" },
    { key: "SOROBAN_POOL_SIZE", desc: "must be a valid integer" },
    { key: "SOROBAN_INVOKE_TIMEOUT_MS", desc: "must be a valid integer" },
    { key: "RPC_CACHE_TTL_MS", desc: "must be a valid integer" },
    { key: "RPC_MAX_RETRIES", desc: "must be a valid integer" },
    { key: "RPC_RETRY_BASE_MS", desc: "must be a valid integer" },
    { key: "RPC_RETRY_BACKOFF", desc: "must be a valid integer" },
    { key: "EVENT_POLL_INTERVAL_MS", desc: "must be a valid integer" },
    { key: "LONG_POLL_DEFAULT_TIMEOUT_MS", desc: "must be a valid integer" },
    { key: "LONG_POLL_MAX_TIMEOUT_MS", desc: "must be a valid integer" },
    { key: "RATE_LIMIT_MAX_BUCKETS", desc: "must be a valid integer" },
    { key: "CORS_MAX_AGE", desc: "must be a valid integer" },
    { key: "ACCESS_LOG_MAX_BYTES", desc: "must be a valid integer" },
    { key: "ACCESS_LOG_MAX_FILES", desc: "must be a valid integer" },
    { key: "LOG_PAYLOAD_MAX_BYTES", desc: "must be a valid integer" },
    { key: "OAUTH_AUTH_CODE_TTL_MS", desc: "must be a valid integer" },
    { key: "OAUTH_ACCESS_TOKEN_TTL_MS", desc: "must be a valid integer" },
    { key: "OAUTH_REFRESH_TOKEN_TTL_MS", desc: "must be a valid integer" },
    { key: "REQUEST_NONCE_TTL_SECONDS", desc: "must be a valid integer" },
    { key: "CACHE_L1_MAX_ENTRIES", desc: "must be a valid integer" },
    { key: "CACHE_L1_DEFAULT_TTL_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_DEFAULT_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_DID_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_CREDENTIAL_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_VERIFICATION_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_API_RESPONSE_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_SESSION_MS", desc: "must be a valid integer" },
    { key: "CACHE_L2_TTL_ANALYTICS_MS", desc: "must be a valid integer" },
    { key: "CACHE_L3_PURGE_TIMEOUT_MS", desc: "must be a valid integer" },
    { key: "CACHE_STAMPEDE_LOCK_TTL_MS", desc: "must be a valid integer" },
    { key: "CACHE_STAMPEDE_WAIT_TIMEOUT_MS", desc: "must be a valid integer" },
    { key: "CACHE_METRICS_LOG_INTERVAL_MS", desc: "must be a valid integer" },
    { key: "STRIPE_TIMEOUT_MS", desc: "must be a valid integer" },
  ];

  for (const item of numericVars) {
    const val = env[item.key];
    if (val !== undefined && val !== "") {
      if (!/^\d+$/.test(val)) {
        invalid.push(`${item.key}: ${item.desc}`);
      }
    }
  }

  const corsOrigin = env.CORS_ORIGIN ?? env.CORS_ALLOWED_ORIGINS;
  if (corsOrigin !== undefined && corsOrigin !== "" && corsOrigin.trim() !== "*") {
    for (const origin of corsOrigin.split(",").map((o) => o.trim()).filter(Boolean)) {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        invalid.push(
          `CORS_ORIGIN: '${origin}' must be an absolute origin such as https://app.example.com, or '*'`,
        );
        continue;
      }
      // An Origin header carries scheme://host[:port] and nothing else, so a
      // configured value with a path or query can never match a real request.
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        invalid.push(
          `CORS_ORIGIN: '${origin}' must not include a path, query or fragment`,
        );
      }
    }
  }

  const corsCredentials = env.CORS_CREDENTIALS;
  if (corsCredentials !== undefined && corsCredentials !== "") {
    const normalized = String(corsCredentials).trim().toLowerCase();
    const known = ["true", "1", "yes", "on", "false", "0", "no", "off"];
    if (!known.includes(normalized)) {
      invalid.push("CORS_CREDENTIALS: must be one of true/false/1/0/yes/no/on/off");
    } else if (["true", "1", "yes", "on"].includes(normalized)) {
      // The CORS spec forbids credentials with a wildcard origin: a browser
      // rejects the response outright, so this combination is never usable.
      const nodeEnvValue = env.NODE_ENV ?? "development";
      const effectiveOrigins =
        corsOrigin ?? (nodeEnvValue === "development" ? "*" : "");
      if (String(effectiveOrigins).trim() === "*") {
        invalid.push(
          "CORS_CREDENTIALS: cannot be enabled while CORS_ORIGIN is '*' — name the allowed origins explicitly",
        );
      }
    }
  }

  const rpcUrl = env.STELLAR_RPC_URL ?? env.RPC_URL;
  if (rpcUrl !== undefined && rpcUrl !== "") {
    try {
      new URL(rpcUrl);
    } catch {
      invalid.push("STELLAR_RPC_URL: must be a valid URL");
    }
  }

  const redisUrl = env.REDIS_URL;
  if (redisUrl !== undefined && redisUrl !== "") {
    try {
      const parsed = new URL(redisUrl);
      if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
        invalid.push("REDIS_URL: must use the redis:// or rediss:// scheme");
      }
    } catch {
      invalid.push("REDIS_URL: must be a valid URL");
    }
  }

  const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
  if (webhookUrl !== undefined && webhookUrl !== "") {
    try {
      new URL(webhookUrl);
    } catch {
      invalid.push("NOTIFICATION_WEBHOOK_URL: must be a valid URL");
    }
  }

  const emailApiUrl = env.EMAIL_API_URL;
  if (emailApiUrl !== undefined && emailApiUrl !== "") {
    try {
      new URL(emailApiUrl);
    } catch {
      invalid.push("EMAIL_API_URL: must be a valid URL");
    }
    if (!env.EMAIL_FROM) {
      invalid.push("EMAIL_FROM: required when EMAIL_API_URL is set");
    }
  }

  // Geo-distributed read replicas (#1051): every configured endpoint must be a
  // usable URL, and routing must only point at regions that exist.
  const replicaEndpoints = parseReplicaEndpoints(env.REPLICA_ENDPOINTS);
  for (const [region, endpoint] of Object.entries(replicaEndpoints)) {
    try {
      new URL(endpoint);
    } catch {
      invalid.push(
        `REPLICA_ENDPOINTS: '${region}' must map to a valid URL, got '${endpoint}'`,
      );
    }
  }

  const replicaRouting = parseRegionRouting(env.REPLICA_REGION_ROUTING);
  for (const [region, replica] of Object.entries(replicaRouting)) {
    if (!replicaEndpoints[replica]) {
      invalid.push(
        `REPLICA_REGION_ROUTING: '${region}' points at unknown replica region '${replica}'`,
      );
    }
  }

  if (
    parseBoolean(env.READ_REPLICAS_ENABLED, false) &&
    Object.keys(replicaEndpoints).length === 0
  ) {
    invalid.push(
      "REPLICA_ENDPOINTS: required when READ_REPLICAS_ENABLED is true",
    );
  }

  const replicaLocalRegion = (env.REPLICA_LOCAL_REGION ?? "").trim().toLowerCase();
  if (
    replicaLocalRegion &&
    Object.keys(replicaEndpoints).length > 0 &&
    !replicaEndpoints[replicaLocalRegion] &&
    !replicaRouting[replicaLocalRegion]
  ) {
    invalid.push(
      `REPLICA_LOCAL_REGION: '${replicaLocalRegion}' is neither a replica endpoint nor a routing key`,
    );
  }

  const cronSchedule = env.EXPIRY_CRON_SCHEDULE;
  if (cronSchedule !== undefined && cronSchedule !== "") {
    try {
      parseCronExpression(cronSchedule);
    } catch (error) {
      invalid.push(`EXPIRY_CRON_SCHEDULE: ${error.message}`);
    }
  }

  // Cache warming (#1118): a malformed schedule would silently never run.
  const cacheWarmCron = env.CACHE_WARM_CRON_SCHEDULE;
  if (cacheWarmCron !== undefined && cacheWarmCron !== "") {
    try {
      parseCronExpression(cacheWarmCron);
    } catch (error) {
      invalid.push(`CACHE_WARM_CRON_SCHEDULE: ${error.message}`);
    }
  }

  const cacheL3PurgeUrl = env.CACHE_L3_PURGE_URL;
  if (cacheL3PurgeUrl !== undefined && cacheL3PurgeUrl !== "") {
    try {
      new URL(cacheL3PurgeUrl);
    } catch {
      invalid.push("CACHE_L3_PURGE_URL: must be a valid URL");
    }
  }

  // Monthly invoicing (#1119): the schedule must parse, and the default tier
  // must exist in the configured tier table or every customer would be
  // billed against a tier that has no pricing.
  const invoiceCron = env.INVOICE_CRON_SCHEDULE;
  if (invoiceCron !== undefined && invoiceCron !== "") {
    try {
      parseCronExpression(invoiceCron);
    } catch (error) {
      invalid.push(`INVOICE_CRON_SCHEDULE: ${error.message}`);
    }
  }

  let billingTiers;
  try {
    billingTiers = parseJson(env.BILLING_TIERS, {
      free: { monthlyCalls: 1000, overageCentsPerCall: 0, custom: false },
      pro: { monthlyCalls: 50000, overageCentsPerCall: 1, custom: false },
      enterprise: { monthlyCalls: 0, overageCentsPerCall: 0, custom: true },
    });
  } catch (error) {
    invalid.push(`BILLING_TIERS: ${error.message}`);
  }
  if (billingTiers && (typeof billingTiers !== "object" || Array.isArray(billingTiers))) {
    invalid.push("BILLING_TIERS: must be a JSON object mapping tier names to pricing");
  } else if (billingTiers) {
    const defaultTier = (env.BILLING_DEFAULT_TIER ?? "free").trim().toLowerCase();
    if (!billingTiers[defaultTier]) {
      invalid.push(
        `BILLING_DEFAULT_TIER: '${defaultTier}' is not defined in BILLING_TIERS`,
      );
    }
  }

  const usageAlertWebhookUrl = env.USAGE_ALERT_WEBHOOK_URL;
  if (usageAlertWebhookUrl !== undefined && usageAlertWebhookUrl !== "") {
    try {
      new URL(usageAlertWebhookUrl);
    } catch {
      invalid.push("USAGE_ALERT_WEBHOOK_URL: must be a valid URL");
    }
  }

  const encryptionEnabled = parseBoolean(env.ENCRYPTION_ENABLED, false);
  if (encryptionEnabled) {
    const rotation = parseInteger(
      env.ENCRYPTION_KEY_ROTATION_SECONDS,
      DEFAULT_ENCRYPTION_KEY_ROTATION_SECONDS,
    );
    const ttl = parseInteger(
      env.ENCRYPTION_SESSION_TTL_SECONDS,
      DEFAULT_ENCRYPTION_SESSION_TTL_SECONDS,
    );
    // A rotation interval at or beyond the session TTL would let a key expire
    // before it is ever rotated, leaving clients unable to decrypt responses.
    if (rotation >= ttl) {
      invalid.push(
        "ENCRYPTION_KEY_ROTATION_SECONDS: must be less than ENCRYPTION_SESSION_TTL_SECONDS",
      );
    }
    const fields = parseList(env.ENCRYPTION_SENSITIVE_FIELDS, []);
    if (fields.length === 0) {
      invalid.push(
        "ENCRYPTION_SENSITIVE_FIELDS: must list at least one response field when ENCRYPTION_ENABLED is true",
      );
    }
  }

  return {
    isValid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

export function logDefaultValues(env = process.env) {
  const defaults = [
    { key: "PORT", defaultVal: "3001" },
    { key: "ADMIN_API_KEY", defaultVal: "''" },
    { key: "ADMIN_ACTOR", defaultVal: "'admin'" },
    { key: "DATA_DIR", defaultVal: "data" },
    { key: "EXPIRY_WARNING_DAYS", defaultVal: "7" },
    { key: "EXPIRY_JOB_INTERVAL_MS", defaultVal: "3600000" },
    { key: "EXPIRY_CONCURRENCY", defaultVal: "8" },
    { key: "RATE_LIMIT_WHITELIST", defaultVal: "'' (no exemptions)" },
    { key: "RATE_LIMIT_MAX_BUCKETS", defaultVal: "10000" },
    { key: "TRUST_PROXY", defaultVal: "false" },
    { key: "REDIS_URL", defaultVal: "'' (cache disabled)" },
    { key: "DID_CACHE_TTL_MS", defaultVal: "60000" },
    { key: "REDIS_MAX_RETRIES", defaultVal: "5" },
    { key: "CACHE_FAILURE_THRESHOLD", defaultVal: "3" },
    { key: "HEALTH_PROBE_TIMEOUT_MS", defaultVal: "2000" },
    { key: "REDIS_URL", defaultVal: "'' (disabled)" },
    { key: "EXPIRY_CRON_SCHEDULE", defaultVal: "'' (interval mode)" },
    { key: "ACCESS_LOG_ENABLED", defaultVal: "true" },
    { key: "ACCESS_LOG_PATH", defaultVal: "'' (stdout only)" },
    { key: "ACCESS_LOG_MAX_BYTES", defaultVal: "10485760" },
    { key: "ACCESS_LOG_MAX_FILES", defaultVal: "5" },
    { key: "LOG_PAYLOADS", defaultVal: "false" },
    { key: "LOG_HEADERS", defaultVal: "false" },
    { key: "TRUST_PROXY", defaultVal: "false" },
    { key: "NOTIFICATION_WEBHOOK_URL", defaultVal: "''" },
    { key: "EMAIL_API_URL", defaultVal: "''" },
    { key: "EMAIL_FROM", defaultVal: "''" },
    { key: "NOTIFICATION_EMAIL", defaultVal: "''" },
    { key: "NOTIFICATION_MAX_RETRIES", defaultVal: "3" },
    { key: "NOTIFICATION_RETRY_BASE_MS", defaultVal: "500" },
    { key: "SUBJECT_NOTIFICATION_WEBHOOKS", defaultVal: "{}" },
    { key: "SOROBAN_POOL_SIZE", defaultVal: "4" },
    { key: "SOROBAN_INVOKE_TIMEOUT_MS", defaultVal: "10000" },
    { key: "STELLAR_CLI", defaultVal: "'stellar'" },
    { key: "STELLAR_NETWORK", defaultVal: "'testnet'" },
    {
      key: "STELLAR_RPC_URL",
      defaultVal: "'https://soroban-testnet.stellar.org'",
    },
    { key: "RPC_CACHE_TTL_MS", defaultVal: "5000" },
    { key: "RPC_MAX_RETRIES", defaultVal: "3" },
    { key: "RPC_RETRY_BASE_MS", defaultVal: "500" },
    { key: "RPC_RETRY_BACKOFF", defaultVal: "2" },
    { key: "EVENT_POLL_INTERVAL_MS", defaultVal: "5000" },
    { key: "LONG_POLL_DEFAULT_TIMEOUT_MS", defaultVal: "30000" },
    { key: "LONG_POLL_MAX_TIMEOUT_MS", defaultVal: "60000" },
    { key: "QUOTA_OVERAGE_MODE", defaultVal: "'block'" },
    { key: "CORS_ORIGIN", defaultVal: "'*' in development, none in production" },
    { key: "CORS_CREDENTIALS", defaultVal: "false" },
    { key: "CORS_METHODS", defaultVal: DEFAULT_CORS_METHODS.join(",") },
    { key: "CORS_ALLOWED_HEADERS", defaultVal: DEFAULT_CORS_ALLOWED_HEADERS.join(",") },
    { key: "CORS_EXPOSED_HEADERS", defaultVal: DEFAULT_CORS_EXPOSED_HEADERS.join(",") },
    { key: "CORS_MAX_AGE", defaultVal: String(DEFAULT_CORS_MAX_AGE) },
    { key: "READ_REPLICAS_ENABLED", defaultVal: "false" },
    { key: "REPLICA_ENDPOINTS", defaultVal: "{} (primary only)" },
    { key: "REPLICA_REGION_ROUTING", defaultVal: "{}" },
    { key: "REPLICA_LOCAL_REGION", defaultVal: "''" },
    { key: "REPLICA_MAX_LAG_MS", defaultVal: "5000" },
    { key: "REPLICA_WARN_LAG_MS", defaultVal: "1000" },
    { key: "REPLICA_LAG_CHECK_INTERVAL_MS", defaultVal: "10000" },
    { key: "REPLICA_FAILURE_THRESHOLD", defaultVal: "3" },
    { key: "REPLICA_RECOVERY_THRESHOLD", defaultVal: "2" },
    { key: "REPLICA_FAILOVER_TO_PRIMARY", defaultVal: "true" },
    { key: "REPLICA_READ_AFTER_WRITE_CONSISTENCY", defaultVal: "true" },
    { key: "REPLICA_CONSISTENCY_WINDOW_MS", defaultVal: "2000" },
    { key: "JAEGER_ENABLED", defaultVal: "false" },
    { key: "JAEGER_SERVICE_NAME", defaultVal: "'soroban-identity-server'" },
    { key: "JAEGER_AGENT_HOST", defaultVal: "'localhost'" },
    { key: "JAEGER_AGENT_PORT", defaultVal: "6832" },
    { key: "JAEGER_SAMPLER_TYPE", defaultVal: "'const'" },
    { key: "JAEGER_SAMPLER_PARAM", defaultVal: "1" },
    { key: "REQUEST_NONCE_ENABLED", defaultVal: "false" },
    { key: "REQUEST_NONCE_TTL_SECONDS", defaultVal: "300" },
    { key: "REQUEST_NONCE_HEADER", defaultVal: "'X-Nonce'" },
    { key: "CACHE_L1_ENABLED", defaultVal: "true" },
    { key: "CACHE_L1_MAX_ENTRIES", defaultVal: "1000" },
    { key: "CACHE_L1_DEFAULT_TTL_MS", defaultVal: "30000" },
    { key: "CACHE_L2_ENABLED", defaultVal: "true" },
    { key: "CACHE_L2_KEY_PREFIX", defaultVal: "'cache:'" },
    { key: "CACHE_L2_TTL_DEFAULT_MS", defaultVal: "60000" },
    { key: "CACHE_L2_TTL_DID_MS", defaultVal: "60000" },
    { key: "CACHE_L2_TTL_CREDENTIAL_MS", defaultVal: "30000" },
    { key: "CACHE_L2_TTL_VERIFICATION_MS", defaultVal: "10000" },
    { key: "CACHE_L2_TTL_API_RESPONSE_MS", defaultVal: "5000" },
    { key: "CACHE_L2_TTL_SESSION_MS", defaultVal: "300000" },
    { key: "CACHE_L2_TTL_ANALYTICS_MS", defaultVal: "600000" },
    { key: "CACHE_L3_ENABLED", defaultVal: "false" },
    { key: "CACHE_L3_PURGE_URL", defaultVal: "'' (no purge)" },
    { key: "CACHE_L3_PURGE_TOKEN", defaultVal: "''" },
    { key: "CACHE_L3_PURGE_TIMEOUT_MS", defaultVal: "5000" },
    { key: "CACHE_WARM_ENABLED", defaultVal: "false" },
    { key: "CACHE_WARM_CRON_SCHEDULE", defaultVal: "'' (startup only)" },
    { key: "CACHE_WARM_KEYS", defaultVal: "'' (none)" },
    { key: "CACHE_WARM_ON_STARTUP", defaultVal: "true" },
    { key: "CACHE_STAMPEDE_LOCK_TTL_MS", defaultVal: "5000" },
    { key: "CACHE_STAMPEDE_WAIT_TIMEOUT_MS", defaultVal: "2000" },
    { key: "CACHE_STAMPEDE_SERVE_STALE", defaultVal: "true" },
    { key: "CACHE_METRICS_ENABLED", defaultVal: "true" },
    { key: "CACHE_METRICS_LOG_INTERVAL_MS", defaultVal: "60000" },
    { key: "METERING_ENABLED", defaultVal: "false" },
    { key: "USAGE_STORAGE_PATH", defaultVal: "data/usage" },
    { key: "BILLING_TIERS", defaultVal: "free/pro/enterprise defaults" },
    { key: "BILLING_DEFAULT_TIER", defaultVal: "'free'" },
    { key: "STRIPE_API_KEY", defaultVal: "'' (invoices not charged)" },
    { key: "STRIPE_WEBHOOK_SECRET", defaultVal: "''" },
    { key: "STRIPE_API_BASE_URL", defaultVal: "'https://api.stripe.com'" },
    { key: "STRIPE_TIMEOUT_MS", defaultVal: "10000" },
    { key: "INVOICE_CRON_SCHEDULE", defaultVal: "'0 0 1 * *'" },
    { key: "INVOICE_CURRENCY", defaultVal: "'usd'" },
    { key: "USAGE_ALERT_THRESHOLDS", defaultVal: "80,100" },
    { key: "USAGE_ALERT_WEBHOOK_URL", defaultVal: "''" },
    { key: "USAGE_DISCOUNT_TIERS", defaultVal: "[]" },
  ];

  for (const item of defaults) {
    let val;
    if (item.key === "STELLAR_RPC_URL") {
      val = env.STELLAR_RPC_URL ?? env.RPC_URL;
    } else {
      val = env[item.key];
    }
    if (val === undefined || val === "") {
      logger.info({ variable: item.key, defaultValue: item.defaultVal }, 'Using default config value');
    }
  }
}
