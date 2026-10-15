/**
 * v2 route helpers (#878).
 *
 * v2 extends v1 routes with a standardised response envelope:
 *
 *   {
 *     "apiVersion": "v2",
 *     "data": <v1 payload>,
 *     "meta": { "timestamp": "<ISO-8601>" }
 *   }
 *
 * List responses additionally promote `pageInfo` to a top-level key inside
 * `data` for richer cursor navigation metadata.
 */

import { V1_ROUTES, withV1Prefix } from "./v1.js";

export const V2_PREFIX = "/v2";

/**
 * All v2 routes share the same path surface as v1 under a /v2 prefix.
 *
 * v2 shares v1's validation contract: the `requestSchema` / `responseSchema`
 * descriptors defined on each v1 route are inherited verbatim via the
 * `{ ...descriptor, path }` spread below. Only the `path` is rewritten to the
 * /v2 prefix; the schemas themselves are intentionally identical to v1.
 *
 * The v2 response *envelope* (apiVersion/data/meta) is not part of the v1
 * response schema, so it is described separately by `v2Envelope` and applied
 * by `wrapResponse` rather than by the inherited route descriptors.
 */
export const V2_ROUTES = Object.fromEntries(
  Object.entries(V1_ROUTES).map(([name, descriptor]) => [
    name,
    { ...descriptor, path: withV1Prefix(descriptor.path).replace("/v1", "/v2") },
  ]),
);

/**
 * Schema descriptor for the v2 response envelope.
 *
 * v1 route `responseSchema` values describe the inner `data` payload; this
 * schema wraps them with the version marker and metadata that v2 adds.
 */
export const v2Envelope = {
  type: "object",
  required: ["apiVersion", "data", "meta"],
  properties: {
    apiVersion: { type: "string", const: "v2" },
    data: { type: "object" },
    meta: {
      type: "object",
      required: ["timestamp"],
      properties: {
        timestamp: { type: "string", format: "date-time" },
      },
    },
  },
};

/**
 * Given a bare path (no version prefix), return the v2-prefixed equivalent.
 *
 * @param {string} path  e.g. "/credentials"
 * @returns {string}     e.g. "/v2/credentials"
 */
export function withV2Prefix(path) {
  if (path.startsWith(V2_PREFIX)) return path;
  return `${V2_PREFIX}${path}`;
}

/**
 * Wrap a v1-style response body in the v2 envelope.
 *
 * For list responses (`data.items` present), `pageInfo` is synthesised from
 * `nextCursor` / `previousCursor` / `pagination` if available.
 *
 * @param {*} data  v1 response payload (already-serialisable object)
 * @returns {object} v2 envelope
 */
export function wrapResponse(data) {
  const envelope = {
    apiVersion: "v2",
    data,
    meta: { timestamp: new Date().toISOString() },
  };

  // Promote cursor pagination fields for list responses.
  if (data && typeof data === "object" && Array.isArray(data.items)) {
    const { items, nextCursor, previousCursor, pagination } = data;
    envelope.data = {
      items,
      pageInfo: {
        nextCursor:      nextCursor      ?? null,
        previousCursor:  previousCursor  ?? null,
        hasNextPage:     Boolean(nextCursor),
        hasPreviousPage: Boolean(previousCursor),
        count:           items.length,
        ...(pagination ?? {}),
      },
      pagination: pagination ?? null,
    };
  }

  return envelope;
}

/**
 * Transform a v1 response payload to the v2 format.
 * Alias of `wrapResponse` exposed for explicit clarity in route handlers.
 *
 * @param {*} v1Payload
 * @returns {object}
 */
export function toV2(v1Payload) {
  return wrapResponse(v1Payload);
}
