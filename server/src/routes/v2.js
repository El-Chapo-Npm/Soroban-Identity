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
import { buildApiRootLinks, buildCredentialCollectionLinks, buildCredentialLinks } from "../hateoas.js";

export const V2_PREFIX = "/v2";

/** All v2 routes share the same path surface as v1 under a /v2 prefix. */
export const V2_ROUTES = Object.fromEntries(
  Object.entries(V1_ROUTES).map(([name, descriptor]) => [
    name,
    { ...descriptor, path: withV1Prefix(descriptor.path).replace("/v1", "/v2") },
  ]),
);

/**
 * Tenant management routes (#1053).
 *
 * Derived from the v1 route map so that every tenant-scoped endpoint keeps a
 * single source of truth for its path, while v2 exposes them under the /v2
 * prefix with the standard v2 response envelope applied by `wrapResponse`.
 */
export const V2_TENANT_ROUTES = Object.fromEntries(
  Object.entries(V1_ROUTES)
    .filter(([name]) => name.startsWith("tenant"))
    .map(([name, descriptor]) => [
      name,
      { ...descriptor, path: withV1Prefix(descriptor.path).replace("/v1", "/v2") },
    ]),
);

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
 * `nextCursor` / `previousCursor` / `pagination` if available, and HATEOAS
 * `_links` are attached (#1069).
 *
 * @param {*} data  v1 response payload (already-serialisable object)
 * @param {Record<string, {href: string, method?: string}>} [links]
 * @returns {object} v2 envelope
 */
export function wrapResponse(data, links) {
  const envelope = {
    apiVersion: "v2",
    data,
    meta: { timestamp: new Date().toISOString() },
  };

  // Promote cursor pagination fields for list responses.
  if (data && typeof data === "object" && Array.isArray(data.items)) {
    const { items, nextCursor, previousCursor, pagination, _links } = data;
    const collectionLinks =
      links ??
      _links ??
      buildCredentialCollectionLinks({
        prefix: V2_PREFIX,
        limit: pagination?.pageSize ?? 50,
        nextCursor: nextCursor ?? null,
        previousCursor: previousCursor ?? null,
      });
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
    envelope._links = collectionLinks;
  } else if (links) {
    envelope._links = links;
  } else if (data && typeof data === "object" && data.id && ("issuer" in data || "credentialType" in data || "subject" in data)) {
    envelope._links = buildCredentialLinks(data, V2_PREFIX);
  } else {
    envelope._links = buildApiRootLinks(V2_PREFIX);
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

/**
 * Route a read query to the nearest healthy read replica (#1051).
 *
 * Reads are served from a geo-distributed replica when one is available and
 * within the acceptable replication lag; otherwise the query transparently
 * falls back to the primary. Callers may opt into strong consistency by
 * passing `{ consistency: "strong" }`, which bypasses replicas entirely.
 *
 * @param {Function} queryFn  executes the query against the given connection
 * @param {object}   [options]
 * @param {"eventual"|"strong"} [options.consistency="eventual"]
 * @param {string}   [options.region]  preferred region hint
 * @returns {Promise<*>} query result
 */
export function readQuery(queryFn, options = {}) {
  const { consistency = "eventual", region } = options;

  if (consistency === "strong") {
    return writeToPrimary(queryFn);
  }

  return readFromReplica(queryFn, { region });
}

/**
 * Route a write query to the primary (#1051).
 *
 * Writes always target the primary; replicas converge asynchronously.
 *
 * @param {Function} queryFn  executes the query against the given connection
 * @returns {Promise<*>} query result
 */
export function writeQuery(queryFn) {
  return writeToPrimary(queryFn);
}

/**
 * Execute a read that must observe a preceding write (read-your-writes).
 *
 * Uses strong consistency so the caller is guaranteed to see the latest
 * committed state rather than a possibly-lagging replica.
 *
 * @param {Function} queryFn
 * @returns {Promise<*>} query result
 */
export function readAfterWrite(queryFn) {
  return readQuery(queryFn, { consistency: "strong" });
}
