/**
 * HATEOAS (Hypermedia as the Engine of Application State) support (#1069).
 *
 * Generates state-aware hypermedia `_links` objects and RFC 8288 `Link` headers
 * across REST API resources so clients can discover available actions and
 * valid state transitions dynamically.
 */

/**
 * Resolve the version prefix (e.g. `""`, `"/v1"`, `"/v2"`) to prepend to
 * hypermedia target URLs based on the incoming request.
 *
 * @param {object} options
 * @param {string} [options.version]
 * @param {boolean} [options.isExplicitUrlVersion]
 * @returns {string}
 */
export function resolveLinkPrefix({ version = "v1", isExplicitUrlVersion = false } = {}) {
  if (version === "v2") return "/v2";
  if (isExplicitUrlVersion && version === "v1") return "/v1";
  return "";
}

/**
 * Root API discovery links (`GET /`, `GET /info`, `GET /v1`, `GET /v2`).
 *
 * @param {string} [prefix=""]
 * @returns {Record<string, {href: string, method: string, title?: string}>}
 */
export function buildApiRootLinks(prefix = "") {
  return {
    self: { href: `${prefix || "/"}`, method: "GET", title: "API root discovery" },
    info: { href: `${prefix}/info`, method: "GET", title: "Server metadata and capabilities" },
    health: { href: `${prefix}/health`, method: "GET", title: "Service health status" },
    credentials: { href: `${prefix}/credentials`, method: "GET", title: "List credentials" },
    issueCredential: { href: `${prefix}/credentials`, method: "POST", title: "Issue a new credential" },
    batch: { href: `${prefix}/batch`, method: "POST", title: "Execute batch credential operations" },
    dids: { href: `${prefix}/dids`, method: "POST", title: "Create or resolve a DID document" },
    webhooks: { href: `${prefix}/webhooks`, method: "GET", title: "List registered webhooks" },
    events: { href: `${prefix}/events`, method: "GET", title: "Server-Sent Events stream" },
    graphql: { href: "/graphql", method: "POST", title: "GraphQL endpoint" },
    openapi: { href: "/openapi.json", method: "GET", title: "OpenAPI 3.0 specification" },
    docs: { href: "/api/docs", method: "GET", title: "Interactive API documentation" },
  };
}

/**
 * State-aware hypermedia links for a single credential resource.
 *
 * Follows HATEOAS principles:
 * - Active (non-revoked, non-expired) credentials expose `revoke`, `update`,
 *   `verify`, and `status` transitions.
 * - Already-revoked credentials omit `revoke` and `update` transitions since
 *   those state transitions are no longer valid.
 *
 * @param {object} credential
 * @param {string} [prefix=""]
 * @returns {Record<string, {href: string, method: string}>}
 */
export function buildCredentialLinks(credential, prefix = "") {
  if (!credential || typeof credential !== "object" || !credential.id) {
    return {};
  }
  const encodedId = encodeURIComponent(String(credential.id));
  const basePath = `${prefix}/credentials/${encodedId}`;
  const isRevoked = Boolean(credential.revoked);

  const links = {
    self: { href: basePath, method: "GET" },
    status: { href: `${basePath}/status`, method: "GET" },
    verify: { href: `${basePath}/verify`, method: "POST" },
    collection: { href: `${prefix}/credentials`, method: "GET" },
  };

  if (!isRevoked) {
    links.update = { href: basePath, method: "PATCH" };
    links.revoke = { href: `${basePath}/revoke`, method: "POST" };
  }

  return links;
}

/**
 * Attach `_links` to a credential object without mutating the canonical record
 * in storage.
 *
 * @param {object} credential
 * @param {string} [prefix=""]
 * @returns {object}
 */
export function withCredentialLinks(credential, prefix = "") {
  if (!credential || typeof credential !== "object") return credential;
  return {
    ...credential,
    _links: buildCredentialLinks(credential, prefix),
  };
}

/**
 * Build hypermedia navigation links for the credentials collection endpoint.
 *
 * @param {object} options
 * @param {string} [options.prefix=""]
 * @param {number} [options.limit=50]
 * @param {string|null} [options.nextCursor=null]
 * @param {string|null} [options.previousCursor=null]
 * @returns {Record<string, {href: string, method: string}>}
 */
export function buildCredentialCollectionLinks({
  prefix = "",
  limit = 50,
  nextCursor = null,
  previousCursor = null,
} = {}) {
  const base = `${prefix}/credentials`;
  const links = {
    self: { href: `${base}?limit=${limit}`, method: "GET" },
    create: { href: base, method: "POST" },
    batch: { href: `${prefix}/batch`, method: "POST" },
  };

  if (nextCursor) {
    links.next = {
      href: `${base}?limit=${limit}&cursor=${encodeURIComponent(nextCursor)}&direction=next`,
      method: "GET",
    };
  }
  if (previousCursor) {
    links.prev = {
      href: `${base}?limit=${limit}&cursor=${encodeURIComponent(previousCursor)}&direction=prev`,
      method: "GET",
    };
  }

  return links;
}

/**
 * State-aware hypermedia links for a DID document.
 *
 * @param {object} didDoc
 * @param {string} [prefix=""]
 * @returns {Record<string, {href: string, method: string}>}
 */
export function buildDidLinks(didDoc, prefix = "") {
  if (!didDoc || typeof didDoc !== "object" || !didDoc.id) return {};
  const encodedDid = encodeURIComponent(String(didDoc.id));
  const links = {
    self: { href: `${prefix}/dids/${encodedDid}`, method: "GET" },
    invalidateCache: { href: `${prefix}/cache/dids/${encodedDid}`, method: "DELETE" },
  };
  if (didDoc.active !== false) {
    links.updateMetadata = { href: `${prefix}/dids/${encodedDid}/metadata`, method: "PUT" };
    links.patchMetadata = { href: `${prefix}/dids/${encodedDid}/metadata`, method: "PATCH" };
  }
  return links;
}

/**
 * Hypermedia links for a webhook resource.
 *
 * @param {object} webhook
 * @param {string} [prefix=""]
 * @returns {Record<string, {href: string, method: string}>}
 */
export function buildWebhookLinks(webhook, prefix = "") {
  if (!webhook || typeof webhook !== "object" || !webhook.id) return {};
  const encodedId = encodeURIComponent(String(webhook.id));
  return {
    self: { href: `${prefix}/webhooks/${encodedId}`, method: "GET" },
    test: { href: `${prefix}/webhooks/${encodedId}/test`, method: "POST" },
    logs: { href: `${prefix}/webhooks/${encodedId}/logs`, method: "GET" },
    delete: { href: `${prefix}/webhooks/${encodedId}`, method: "DELETE" },
    collection: { href: `${prefix}/webhooks`, method: "GET" },
  };
}

/**
 * Format a `_links` map into an RFC 8288 `Link` HTTP header value.
 *
 * @param {Record<string, {href: string, method?: string}>} links
 * @returns {string}
 */
export function formatLinkHeader(links) {
  if (!links || typeof links !== "object") return "";
  return Object.entries(links)
    .filter(([, desc]) => desc && typeof desc.href === "string")
    .map(([rel, desc]) => `<${desc.href}>; rel="${rel}"`)
    .join(", ");
}
