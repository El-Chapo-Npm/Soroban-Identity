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
  shortenShareLink:    { method: "POST",   path: "/share/shorten" },
  resolveShareLink:    { method: "GET",    path: "/share/:id" },
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
 * Privacy options supported for credential sharing (#1030).
 */
export const SHARE_PRIVACY_OPTIONS = ["public", "private", "selective"];

/**
 * Normalise a requested share privacy setting, defaulting to "private".
 *
 * @param {string} [privacy]
 * @returns {"public"|"private"|"selective"}
 */
export function normalizeSharePrivacy(privacy) {
  const value = String(privacy || "").toLowerCase();
  return SHARE_PRIVACY_OPTIONS.includes(value) ? value : "private";
}

/**
 * Generate a short, URL-safe share id.
 *
 * @param {() => number} [random]  injectable RNG for deterministic tests
 * @returns {string}
 */
export function generateShareId(random = Math.random) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[Math.floor(random() * alphabet.length)];
  }
  return id;
}

/**
 * POST /share/shorten handler.
 *
 * Creates a short id for a share URL and records a `share_created`
 * analytics event. The target URL is validated to be an absolute http(s)
 * URL so that shared links cannot be used to redirect to arbitrary schemes.
 *
 * @param {object} deps
 * @param {{ createShortLink: Function }} [deps.shareService]
 * @param {{ track: Function }} [deps.analyticsService]
 * @param {object} [deps.body]  request body ({ url, privacy, credentialId })
 * @returns {Promise<{ id: string, url: string, privacy: string }>}
 */
export async function shortenShareLink({ shareService, analyticsService, body = {} } = {}) {
  const targetUrl = body?.url;
  if (typeof targetUrl !== "string" || !/^https?:\/\//i.test(targetUrl)) {
    const err = new Error("A valid http(s) url is required");
    err.status = 400;
    throw err;
  }

  const privacy = normalizeSharePrivacy(body?.privacy);
  const id = shareService && typeof shareService.createShortLink === "function"
    ? await shareService.createShortLink({ url: targetUrl, privacy, credentialId: body?.credentialId })
    : generateShareId();

  if (analyticsService && typeof analyticsService.track === "function") {
    await analyticsService.track("share_created", {
      shareId: id,
      privacy,
      credentialId: body?.credentialId,
    });
  }

  return { id, url: withV1Prefix(`/share/${id}`), privacy };
}

/**
 * GET /share/:id handler.
 *
 * Resolves a short id to its target URL, records a `share_opened` analytics
 * event, and returns the target so the caller can redirect. Shared links
 * carry the credential id (when present) so the recipient can verify the
 * credential from the shared link.
 *
 * @param {object} deps
 * @param {{ resolveShortLink: Function }} [deps.shareService]
 * @param {{ track: Function }} [deps.analyticsService]
 * @param {object} [deps.params]  route params ({ id })
 * @returns {Promise<{ url: string, privacy: string, credentialId?: string }>}
 */
export async function resolveShareLink({ shareService, analyticsService, params = {} } = {}) {
  const id = params?.id;
  if (!id) {
    const err = new Error("Share id is required");
    err.status = 400;
    throw err;
  }

  const resolved = shareService && typeof shareService.resolveShortLink === "function"
    ? await shareService.resolveShortLink(id)
    : null;
  if (!resolved || typeof resolved.url !== "string") {
    const err = new Error("Share link not found");
    err.status = 404;
    throw err;
  }

  if (analyticsService && typeof analyticsService.track === "function") {
    await analyticsService.track("share_opened", {
      shareId: id,
      privacy: resolved.privacy,
      credentialId: resolved.credentialId,
    });
  }

  return {
    url: resolved.url,
    privacy: normalizeSharePrivacy(resolved.privacy),
    ...(resolved.credentialId ? { credentialId: resolved.credentialId } : {}),
  };
}

/**
 * Build the v1 route map entries for credential sharing (#1030), so app.js
 * can register them consistently with networkStatisticsRoute.
 *
 * @param {object} deps
 * @param {{ createShortLink: Function, resolveShortLink: Function }} [deps.shareService]
 * @param {{ track: Function }} [deps.analyticsService]
 * @returns {Array<{ method: string, path: string, handler: Function }>}
 */
export function shareRoutes({ shareService, analyticsService } = {}) {
  return [
    {
      method: V1_ROUTES.shortenShareLink.method,
      path: withV1Prefix(V1_ROUTES.shortenShareLink.path),
      handler: (req) => shortenShareLink({ shareService, analyticsService, body: req?.body }),
    },
    {
      method: V1_ROUTES.resolveShareLink.method,
      path: withV1Prefix(V1_ROUTES.resolveShareLink.path),
      handler: (req) => resolveShareLink({ shareService, analyticsService, params: req?.params }),
    },
  ];
}
