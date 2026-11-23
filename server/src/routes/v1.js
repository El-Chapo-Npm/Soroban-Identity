/**
 * v1 route helpers (#878).
 *
 * Defines the canonical route map for API version 1 and helper utilities
 * used by both v1 handlers in app.js and the version negotiation tests.
 *
 * v1 is the default version and remains fully backward-compatible: requests
 * to unversioned paths (e.g. `/credentials`) are transparently treated as
 * `/v1/credentials` by the version middleware.
 */

export const V1_PREFIX = "/v1";

/**
 * Canonical route descriptors for v1.
 * Each entry maps a logical name to the method + path pattern (without prefix).
 *
 * `read` marks routes that are safe to serve from a geo-distributed read
 * replica (see #1051). Routes without `read: true` are writes and must be
 * routed to the primary. `consistency` may be set to "strong" on read routes
 * that must observe the latest committed write (e.g. post-write status
 * checks); such routes are pinned to the primary to avoid stale reads.
 */
export const V1_ROUTES = {
  listCredentials:     { method: "GET",    path: "/credentials",              read: true },
  getCredential:       { method: "GET",    path: "/credentials/:id",          read: true },
  credentialStatus:    { method: "GET",    path: "/credentials/:id/status",   read: true, consistency: "strong" },
  verifyCredential:    { method: "POST",   path: "/credentials/:id/verify" },
  issueCredential:     { method: "POST",   path: "/credentials" },
  revokeCredential:    { method: "POST",   path: "/credentials/:id/revoke" },
  batchOperations:     { method: "POST",   path: "/batch" },
  listWebhooks:        { method: "GET",    path: "/webhooks",                 read: true },
  createWebhook:       { method: "POST",   path: "/webhooks" },
  deleteWebhook:       { method: "DELETE", path: "/webhooks/:id" },
  listIssuers:         { method: "GET",    path: "/admin/issuers",            read: true },
  addIssuer:           { method: "POST",   path: "/admin/issuers" },
  removeIssuer:        { method: "DELETE", path: "/admin/issuers" },
  expiryReport:        { method: "GET",    path: "/admin/expiry-report" },
  listTenants:         { method: "GET",    path: "/admin/tenants" },
  createTenant:        { method: "POST",   path: "/admin/tenants" },
  getTenant:           { method: "GET",    path: "/admin/tenants/:id" },
  updateTenant:        { method: "PATCH",  path: "/admin/tenants/:id" },
  deleteTenant:        { method: "DELETE", path: "/admin/tenants/:id" },
  getTenantLimits:     { method: "GET",    path: "/admin/tenants/:id/limits" },
  updateTenantLimits:  { method: "PATCH",  path: "/admin/tenants/:id/limits" },
  getTenantConfig:     { method: "GET",    path: "/admin/tenants/:id/config" },
  updateTenantConfig:  { method: "PATCH",  path: "/admin/tenants/:id/config" },
  listTenantMembers:   { method: "GET",    path: "/admin/tenants/:id/members" },
  addTenantMember:     { method: "POST",   path: "/admin/tenants/:id/members" },
  removeTenantMember:  { method: "DELETE", path: "/admin/tenants/:id/members/:memberId" },
  health:              { method: "GET",    path: "/health" },
  info:                { method: "GET",    path: "/info" },
  metrics:             { method: "GET",    path: "/metrics" },
  cacheStats:          { method: "GET",    path: "/cache/stats",              read: true },
  cachePurge:          { method: "POST",   path: "/cache/purge" },
};

/**
 * Resolve the logical route descriptor for a request.
 *
 * @param {string} method  HTTP method, e.g. "GET"
 * @param {string} path    bare or v1-prefixed path, e.g. "/v1/credentials/42"
 * @returns {object|undefined} the matching V1_ROUTES entry, if any
 */
export function resolveRoute(method, path) {
  const bare = stripV1Prefix(path);
  const upper = String(method || "").toUpperCase();
  for (const descriptor of Object.values(V1_ROUTES)) {
    if (descriptor.method !== upper) continue;
    if (matchPath(descriptor.path, bare)) return descriptor;
  }
  return undefined;
}

/**
 * Match a route pattern (with `:param` segments) against a concrete path.
 *
 * @param {string} pattern  e.g. "/credentials/:id"
 * @param {string} path     e.g. "/credentials/42"
 * @returns {boolean}
 */
export function matchPath(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) =>
    part.startsWith(":") ? pathParts[i].length > 0 : part === pathParts[i]
  );
}

/**
 * Decide whether a request should be served by a read replica or the primary.
 *
 * Read/write splitting (#1051): reads are routed to the nearest healthy
 * replica, while writes and strongly-consistent reads are pinned to the
 * primary. Unknown routes default to the primary so that new endpoints are
 * never accidentally served from a potentially stale replica.
 *
 * @param {string} method  HTTP method
 * @param {string} path    request path (bare or v1-prefixed)
 * @returns {"replica"|"primary"}
 */
export function routeTarget(method, path) {
  const descriptor = resolveRoute(method, path);
  if (!descriptor) return "primary";
  if (descriptor.read !== true) return "primary";
  if (descriptor.consistency === "strong") return "primary";
  return "replica";
}

/**
 * Select the nearest healthy read replica for a request.
 *
 * Replicas are ordered by ascending measured latency; unhealthy replicas and
 * replicas whose lag exceeds `maxLagMs` are skipped. If no replica is
 * eligible, `null` is returned and the caller must fall back to the primary
 * (failover on replica failure).
 *
 * @param {object}   options
 * @param {Array<{region: string, latencyMs: number, healthy: boolean, lagMs: number}>} options.replicas
 * @param {string}   [options.region]   preferred region of the caller
 * @param {number}   [options.maxLagMs] maximum acceptable replication lag
 * @returns {object|null} the chosen replica, or null to use the primary
 */
export function selectReplica({ replicas = [], region, maxLagMs = 5000 } = {}) {
  const eligible = replicas.filter(
    (r) => r && r.healthy !== false && (r.lagMs ?? 0) <= maxLagMs
  );
  if (eligible.length === 0) return null;

  const local = region ? eligible.filter((r) => r.region === region) : [];
  const pool = local.length > 0 ? local : eligible;

  return pool.reduce((best, r) =>
    (r.latencyMs ?? Infinity) < (best.latencyMs ?? Infinity) ? r : best
  );
}

/**
 * Determine whether a replica's replication lag is within tolerance.
 *
 * Used by replica lag monitoring (#1051) to decide when a replica should be
 * taken out of rotation.
 *
 * @param {number} lagMs
 * @param {number} [maxLagMs]
 * @returns {boolean}
 */
export function isReplicaLagAcceptable(lagMs, maxLagMs = 5000) {
  return typeof lagMs === "number" && lagMs >= 0 && lagMs <= maxLagMs;
}

/**
 * Given a bare path (no version prefix), return the v1-prefixed equivalent.
 *
 * @param {string} path  e.g. "/credentials"
 * @returns {string}     e.g. "/v1/credentials"
 */
export function withV1Prefix(path) {
  if (path.startsWith(V1_PREFIX)) return path;
  return `${V1_PREFIX}${path}`;
}

/**
 * Strip the /v1 prefix from a path if present, normalising to the bare form.
 *
 * @param {string} path  e.g. "/v1/credentials"
 * @returns {string}     e.g. "/credentials"
 */
export function stripV1Prefix(path) {
  if (path.startsWith(V1_PREFIX + "/")) return path.slice(V1_PREFIX.length);
  if (path === V1_PREFIX) return "/";
  return path;
}

/**
 * v1 response envelope – the response body is returned as-is.
 * Included for symmetry with v2's wrapResponse helper.
 *
 * @param {*} data
 * @returns {*}
 */
export function wrapResponse(data) {
  return data;
}

/**
 * Scopes permitted to read aggregated network statistics.
 */
export const NETWORK_STATISTICS_SCOPES = ["admin:read", "analytics:read"];

/**
 * Check whether the given scopes grant access to network statistics.
 *
 * @param {string[]|string|undefined} scopes
 * @returns {boolean}
 */
export function canReadNetworkStatistics(scopes) {
  if (!scopes) return false;
  const list = Array.isArray(scopes) ? scopes : String(scopes).split(/\s+/);
  return list.some((scope) => NETWORK_STATISTICS_SCOPES.includes(scope));
}

/**
 * GET /analytics/network-statistics handler.
 *
 * Returns the aggregated network statistics payload produced by
 * AnalyticsService (DID/credential totals over time, top issuers,
 * geographic distribution, verification success rate, credential type
 * distribution, etc.).
 *
 * Requires the `admin:read` or `analytics:read` scope.
 *
 * @param {object} deps
 * @param {{ getNetworkStatistics: Function }} deps.analyticsService
 * @param {object} [deps.query]  optional query params forwarded to the service
 * @returns {Promise<*>}
 */
export async function getNetworkStatistics({ analyticsService, query = {} } = {}) {
  if (!analyticsService || typeof analyticsService.getNetworkStatistics !== "function") {
    throw new Error("AnalyticsService with getNetworkStatistics() is required");
  }
  return analyticsService.getNetworkStatistics(query);
}

/**
 * Build the v1 route map entry for network statistics, including the
 * required scope check, so app.js can register it consistently.
 *
 * @param {object} deps
 * @param {{ getNetworkStatistics: Function }} deps.analyticsService
 * @returns {{ method: string, path: string, scopes: string[], handler: Function }}
 */
export function networkStatisticsRoute({ analyticsService } = {}) {
  return {
    method: V1_ROUTES.networkStatistics.method,
    path: withV1Prefix(V1_ROUTES.networkStatistics.path),
    scopes: NETWORK_STATISTICS_SCOPES,
    handler: (req) => {
      if (!canReadNetworkStatistics(req?.scopes ?? req?.user?.scopes)) {
        const err = new Error("Insufficient scope for network statistics");
        err.status = 403;
        throw err;
      }
      return getNetworkStatistics({ analyticsService, query: req?.query });
    },
  };
}

/**
 * Scopes permitted to inspect cache statistics.
 */
export const CACHE_STATS_SCOPES = ["admin:read", "cache:read"];

/**
 * Scopes permitted to manually purge cache entries.
 */
export const CACHE_PURGE_SCOPES = ["admin:write", "cache:write"];

/**
 * Check whether the given scopes grant access to cache statistics.
 *
 * @param {string[]|string|undefined} scopes
 * @returns {boolean}
 */
export function canReadCacheStats(scopes) {
  if (!scopes) return false;
  const list = Array.isArray(scopes) ? scopes : String(scopes).split(/\s+/);
  return list.some((scope) => CACHE_STATS_SCOPES.includes(scope));
}

/**
 * Check whether the given scopes grant access to cache purging.
 *
 * @param {string[]|string|undefined} scopes
 * @returns {boolean}
 */
export function canPurgeCache(scopes) {
  if (!scopes) return false;
  const list = Array.isArray(scopes) ? scopes : String(scopes).split(/\s+/);
  return list.some((scope) => CACHE_PURGE_SCOPES.includes(scope));
}

/**
 * Compute the hit ratio for a single cache layer.
 *
 * @param {number} hits
 * @param {number} misses
 * @returns {number} ratio in [0, 1], or 0 when there was no traffic
 */
export function cacheHitRatio(hits, misses) {
  const h = Number(hits) || 0;
  const m = Number(misses) || 0;
  const total = h + m;
  if (total <= 0) return 0;
  return h / total;
}

/**
 * Normalise raw cache statistics into a per-layer hit/miss report.
 *
 * Accepts either a `{ layers: { l1: {hits, misses}, ... } }` object or a flat
 * `{ l1: {hits, misses}, ... }` map. Each layer in the output includes its
 * hit/miss counts and hit ratio.
 *
 * @param {object} stats
 * @returns {{ layers: Record<string, {hits: number, misses: number, hitRatio: number}>, overallHitRatio: number }}
 */
export function summarizeCacheStats(stats = {}) {
  const source = stats && typeof stats === "object" && stats.layers ? stats.layers : stats || {};
  const layers = {};
  let totalHits = 0;
  let totalMisses = 0;

  for (const [name, layer] of Object.entries(source)) {
    if (!layer || typeof layer !== "object") continue;
    const hits = Number(layer.hits) || 0;
    const misses = Number(layer.misses) || 0;
    layers[name] = { hits, misses, hitRatio: cacheHitRatio(hits, misses) };
    totalHits += hits;
    totalMisses += misses;
  }

  return { layers, overallHitRatio: cacheHitRatio(totalHits, totalMisses) };
}

/**
 * GET /cache/stats handler.
 *
 * Returns hit/miss ratios per cache layer (L1 in-memory, L2 Redis, L3 CDN,
 * etc.) as reported by the cache service.
 *
 * Requires the `admin:read` or `cache:read` scope.
 *
 * @param {object} deps
 * @param {{ getStats: Function }} deps.cacheService
 * @returns {Promise<*>}
 */
export async function getCacheStats({ cacheService } = {}) {
  if (!cacheService || typeof cacheService.getStats !== "function") {
    throw new Error("CacheService with getStats() is required");
  }
  const stats = await cacheService.getStats();
  return summarizeCacheStats(stats);
}

/**
 * POST /cache/purge handler.
 *
 * Manually invalidates cache entries by key or by data type. At least one of
 * `key` or `dataType` must be provided.
 *
 * Requires the `admin:write` or `cache:write` scope.
 *
 * @param {object} deps
 * @param {{ invalidate: Function }} deps.cacheService
 * @param {{ key?: string, dataType?: string }} [deps.body]
 * @returns {Promise<*>}
 */
export async function purgeCache({ cacheService, body = {} } = {}) {
  if (!cacheService || typeof cacheService.invalidate !== "function") {
    throw new Error("CacheService with invalidate() is required");
  }
  const { key, dataType } = body || {};
  if (!key && !dataType) {
    const err = new Error("Either 'key' or 'dataType' is required to purge cache");
    err.status = 400;
    throw err;
  }
  return cacheService.invalidate({ key, dataType });
}

/**
 * Build the v1 route map entry for cache statistics, including the required
 * scope check, so app.js can register it consistently.
 *
 * @param {object} deps
 * @param {{ getStats: Function }} deps.cacheService
 * @returns {{ method: string, path: string, scopes: string[], handler: Function }}
 */
export function cacheStatsRoute({ cacheService } = {}) {
  return {
    method: V1_ROUTES.cacheStats.method,
    path: withV1Prefix(V1_ROUTES.cacheStats.path),
    scopes: CACHE_STATS_SCOPES,
    handler: (req) => {
      if (!canReadCacheStats(req?.scopes ?? req?.user?.scopes)) {
        const err = new Error("Insufficient scope for cache statistics");
        err.status = 403;
        throw err;
      }
      return getCacheStats({ cacheService });
    },
  };
}

/**
 * Build the v1 route map entry for cache purging, including the required
 * scope check, so app.js can register it consistently.
 *
 * @param {object} deps
 * @param {{ invalidate: Function }} deps.cacheService
 * @returns {{ method: string, path: string, scopes: string[], handler: Function }}
 */
export function cachePurgeRoute({ cacheService } = {}) {
  return {
    method: V1_ROUTES.cachePurge.method,
    path: withV1Prefix(V1_ROUTES.cachePurge.path),
    scopes: CACHE_PURGE_SCOPES,
    handler: (req) => {
      if (!canPurgeCache(req?.scopes ?? req?.user?.scopes)) {
        const err = new Error("Insufficient scope for cache purge");
        err.status = 403;
        throw err;
      }
      return purgeCache({ cacheService, body: req?.body });
    },
  };
}
