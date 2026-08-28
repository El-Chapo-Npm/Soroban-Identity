# ETags & Conditional Requests

## Overview

Credential responses carry an `ETag` header for cache validation (`If-None-Match`) and optimistic concurrency control on writes (`If-Match`).

## Strong vs. weak

- **Single-item `GET /credentials/{id}`** returns a **strong** ETag — a SHA-1 hash of the canonical credential object, computed the same way regardless of any [`fields` filtering](./field-filtering.md) applied to the response body. This keeps the ETag a stable identifier for the resource's state (matching what the revoke endpoint checks against below), rather than varying with whatever subset of fields a particular request happened to ask for.
- **Collection `GET /credentials`** returns a **weak** ETag (`W/"..."`), because the same query can legitimately return a page whose representation shifts slightly between calls (e.g. a credential issued in between) without that being a meaningful change from the caller's point of view.

## Conditional GET (`If-None-Match`)

```bash
curl -i http://localhost:3001/credentials/cred-123
# ETag: "3a7f...  "

curl -i http://localhost:3001/credentials/cred-123 -H 'If-None-Match: "3a7f..."'
# HTTP/1.1 304 Not Modified
```

`If-None-Match` comparison is weak per [RFC 7232 §2.3.2](https://www.rfc-editor.org/rfc/rfc7232#section-2.3.2) — a `W/` prefix on either side is ignored. A bare `*` matches any current representation.

## Optimistic concurrency (`If-Match`)

`DELETE /credentials/{id}` (and `POST /credentials/{id}/revoke`) accept an `If-Match` header. When present, the revoke is rejected with `412 Precondition Failed` unless it matches the credential's *current* strong ETag — guarding against acting on a stale read (e.g. revoking a credential another client already changed since you last fetched it).

```bash
curl -X DELETE http://localhost:3001/credentials/cred-123 \
  -H "X-API-Key: $KEY" \
  -H 'If-Match: "3a7f..."'
```

```json
{ "code": "PRECONDITION_FAILED", "message": "If-Match header does not match the current credential state." }
```

`If-Match` comparison is strong — a weak tag on either side never matches. Omitting `If-Match` entirely skips the check (unconditional write), preserving backward compatibility with existing clients.
