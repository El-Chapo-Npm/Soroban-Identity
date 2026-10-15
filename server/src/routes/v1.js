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

import {
  listCredentialsRequestSchema,
  listCredentialsResponseSchema,
  getCredentialRequestSchema,
  getCredentialResponseSchema,
  credentialStatusRequestSchema,
  credentialStatusResponseSchema,
  verifyCredentialRequestSchema,
  verifyCredentialResponseSchema,
  issueCredentialRequestSchema,
  issueCredentialResponseSchema,
  revokeCredentialRequestSchema,
  revokeCredentialResponseSchema,
  batchOperationsRequestSchema,
  batchOperationsResponseSchema,
  listWebhooksRequestSchema,
  listWebhooksResponseSchema,
  createWebhookRequestSchema,
  createWebhookResponseSchema,
  deleteWebhookRequestSchema,
  deleteWebhookResponseSchema,
  listIssuersRequestSchema,
  listIssuersResponseSchema,
  addIssuerRequestSchema,
  addIssuerResponseSchema,
  removeIssuerRequestSchema,
  removeIssuerResponseSchema,
  expiryReportRequestSchema,
  expiryReportResponseSchema,
  healthRequestSchema,
  healthResponseSchema,
  infoRequestSchema,
  infoResponseSchema,
  metricsRequestSchema,
  metricsResponseSchema,
} from "../schemas/index.ts";

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
 * Validation contract for v1 routes, keyed by the same logical names as
 * `V1_ROUTES`. Each entry carries optional Zod request/response schema
 * descriptors so middleware can be attached declaratively. v2 inherits
 * these automatically unless it overrides them.
 */
export const V1_SCHEMAS = {
  listCredentials:  { requestSchema: listCredentialsRequestSchema,  responseSchema: listCredentialsResponseSchema },
  getCredential:    { requestSchema: getCredentialRequestSchema,    responseSchema: getCredentialResponseSchema },
  credentialStatus: { requestSchema: credentialStatusRequestSchema, responseSchema: credentialStatusResponseSchema },
  verifyCredential: { requestSchema: verifyCredentialRequestSchema, responseSchema: verifyCredentialResponseSchema },
  issueCredential:  { requestSchema: issueCredentialRequestSchema,  responseSchema: issueCredentialResponseSchema },
  revokeCredential: { requestSchema: revokeCredentialRequestSchema, responseSchema: revokeCredentialResponseSchema },
  batchOperations:  { requestSchema: batchOperationsRequestSchema,  responseSchema: batchOperationsResponseSchema },
  listWebhooks:     { requestSchema: listWebhooksRequestSchema,     responseSchema: listWebhooksResponseSchema },
  createWebhook:    { requestSchema: createWebhookRequestSchema,    responseSchema: createWebhookResponseSchema },
  deleteWebhook:    { requestSchema: deleteWebhookRequestSchema,    responseSchema: deleteWebhookResponseSchema },
  listIssuers:      { requestSchema: listIssuersRequestSchema,      responseSchema: listIssuersResponseSchema },
  addIssuer:        { requestSchema: addIssuerRequestSchema,        responseSchema: addIssuerResponseSchema },
  removeIssuer:     { requestSchema: removeIssuerRequestSchema,     responseSchema: removeIssuerResponseSchema },
  expiryReport:     { requestSchema: expiryReportRequestSchema,     responseSchema: expiryReportResponseSchema },
  health:           { requestSchema: healthRequestSchema,           responseSchema: healthResponseSchema },
  info:             { requestSchema: infoRequestSchema,             responseSchema: infoResponseSchema },
  metrics:          { requestSchema: metricsRequestSchema,          responseSchema: metricsResponseSchema },
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
