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
 */
export const V1_ROUTES = {
  listCredentials:     { method: "GET",    path: "/credentials" },
  getCredential:       { method: "GET",    path: "/credentials/:id" },
  credentialStatus:    { method: "GET",    path: "/credentials/:id/status" },
  verifyCredential:    { method: "POST",   path: "/credentials/:id/verify" },
  issueCredential:     { method: "POST",   path: "/credentials" },
  revokeCredential:    { method: "POST",   path: "/credentials/:id/revoke" },
  batchOperations:     { method: "POST",   path: "/batch" },
  listWebhooks:        { method: "GET",    path: "/webhooks" },
  createWebhook:       { method: "POST",   path: "/webhooks" },
  deleteWebhook:       { method: "DELETE", path: "/webhooks/:id" },
  listIssuers:         { method: "GET",    path: "/admin/issuers" },
  addIssuer:           { method: "POST",   path: "/admin/issuers" },
  removeIssuer:        { method: "DELETE", path: "/admin/issuers" },
  expiryReport:        { method: "GET",    path: "/admin/expiry-report" },
  health:              { method: "GET",    path: "/health" },
  info:                { method: "GET",    path: "/info" },
  metrics:             { method: "GET",    path: "/metrics" },
};

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
