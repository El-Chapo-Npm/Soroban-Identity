# Sparse Fieldsets (Field Filtering)

## Overview

`GET /credentials` and `GET /credentials/{id}` accept a `fields` query parameter to return only the requested fields, trimming payload size for clients that only need a subset of a credential. Full definitions live in [`server/openapi.json`](../server/openapi.json).

```bash
curl "http://localhost:3001/credentials/cred-123?fields=id,claims.tier"
```

```json
{ "id": "cred-123", "claims": { "tier": "gold" } }
```

## Nested fields

A dotted path (`claims.tier`) selects a nested field without pulling in the rest of `claims`. Only the top-level segment (`claims`) is validated against the credential's known fields; anything below that is passed through as-is.

## Selectable fields

`id`, `subject`, `issuer`, `type`, `claims`, `expiresAt` / `expires_at`, `issuedAt` / `issued_at`, `revoked`, `revokedAt`, `metadata`.

## Validation

Requesting an unknown top-level field returns `400 VALIDATION_FAILED` rather than silently ignoring it:

```bash
curl "http://localhost:3001/credentials/cred-123?fields=id,bogus"
```

```json
{ "code": "VALIDATION_FAILED", "message": "Unknown field(s): bogus", "errors": [{ "field": "fields", "source": "query", "message": "Unknown field(s): bogus", "code": "unknown_field" }] }
```

## Interaction with other features

- Omitting `fields` returns the full object (default field set), unchanged from before.
- `fields` is ignored on the [JSON-LD representation](./verifiable-credentials-jsonld.md) (`?format=jsonld` / `Accept: application/ld+json`), which has its own W3C-defined shape.
- The [ETag](./etags.md) returned is computed from the canonical (unfiltered) credential, not the `fields`-filtered body — so it stays a stable identifier for the resource's state and remains usable in `If-Match` regardless of which `fields` a request used.
