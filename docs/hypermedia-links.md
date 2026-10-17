# Hypermedia Links (HATEOAS)

## Overview

REST responses include a `_links` object listing the related resources and the actions a client can take next. Each link has an `href` and the HTTP `method` to use. The same links are also sent as an RFC 8288 `Link` header, so clients can follow links instead of hard-coding URL templates. The links come from [`server/src/hateoas.js`](../server/src/hateoas.js).

```bash
curl "http://localhost:3001/credentials/cred-123"
```

```json
{
  "id": "cred-123",
  "revoked": false,
  "_links": {
    "self":       { "href": "/credentials/cred-123",        "method": "GET" },
    "status":     { "href": "/credentials/cred-123/status", "method": "GET" },
    "verify":     { "href": "/credentials/cred-123/verify", "method": "POST" },
    "collection": { "href": "/credentials",                 "method": "GET" },
    "update":     { "href": "/credentials/cred-123",        "method": "PATCH" },
    "revoke":     { "href": "/credentials/cred-123/revoke", "method": "POST" }
  }
}
```

## Where links appear

| Endpoint | Links |
|---|---|
| `GET /` and `GET /info` | API discovery: `credentials`, `issueCredential`, `batch`, `dids`, `webhooks`, `events`, `graphql`, `openapi`, `docs`, and more |
| `GET /credentials` | `self`, `create`, `batch`, plus `next` / `prev` when those pages exist. Each item in `items` also carries its own credential links. |
| `GET /credentials/{id}` | The credential links shown above |
| `GET /credentials/{id}/status` | The credential links |
| `GET /dids/{did}`, `POST /dids`, `PUT`/`PATCH /dids/{did}` | DID document links (see [DID endpoints](./did-endpoints.md)) |

## State-aware transitions

Links describe only the transitions that are valid for the resource's current state. A revoked credential has no `revoke` or `update` link, because neither action can succeed on it any more. `self`, `status`, `verify`, and `collection` are always present.

## URLs and versioning

Links are relative paths, matching the pagination `Link` header (see [cursor pagination](./cursor-pagination.md)). Because they're relative, they stay correct behind a proxy. Resolve them against the URL you called.

Links keep the version you asked for: a request to `/v2/credentials/cred-123` gets `/v2/...` links, and an explicit `/v1/...` request gets `/v1/...` links. An unversioned request gets unversioned links. Credential IDs are percent-encoded.

## Interaction with other features

- **[Sparse fieldsets](./field-filtering.md):** when `?fields=` is supplied, items contain only the requested fields and no `_links`.
- **[ETags](./etags.md):** a credential's ETag is computed from the stored credential, so it doesn't depend on `_links`.
- **[JSON-LD](./verifiable-credentials-jsonld.md):** the `?format=jsonld` / `Accept: application/ld+json` representation has its own W3C-defined shape.
- **Authorization:** a link only says an action exists. It doesn't mean the caller is allowed to perform it. `verify` still needs `credentials:read`, and `revoke` / `update` still need `credentials:write`.
