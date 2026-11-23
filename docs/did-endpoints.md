# DID Endpoints

## Overview

The REST server exposes DID documents for resolution and for maintaining the server-side DID cache. DIDs use the form `did:stellar:<Stellar account>`, and `{did}` in a path can be either the full DID or the bare `G...` address.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/dids/{did}` | None | Resolve a DID document (cache first, then the identity contract) |
| `POST` | `/dids` (alias `/identity/did`) | `admin:write` | Create a DID document in the cache. Returns `201` (`200` for the alias). |
| `PUT` | `/dids/{did}` | `admin:write` | Replace the document's metadata |
| `PATCH` | `/dids/{did}` | `admin:write` | Merge into the document's metadata |

Writes need `admin:write` because they go to the DID cache, and resolution reads the cache before the chain. Without authentication, any caller could change the document that every client resolves for a DID.

```bash
curl -X POST http://localhost:3001/dids \
  -H "X-API-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"address":"GAAA...","metadata":{"name":"Ada 😀"}}'
```

Responses include [hypermedia links](./hypermedia-links.md).

## Unicode in metadata

Metadata can be any JSON object. Its values are sanitized on every write and on every resolution, including documents read back from the chain, so unusual text can't cause a server error:

- **Kept as-is:** valid Unicode, including emoji, ZWJ sequences, CJK, right-to-left scripts, and symbols.
- **Normalized to NFC:** text, so `e` followed by a combining acute accent is stored as `é`.
- **Replaced with U+FFFD:** lone (unpaired) UTF-16 surrogates.
- **Removed:** control characters, except tab and newline in values. Keys are also trimmed, and a key that ends up empty is dropped.

Metadata that isn't a JSON object (for example, an array) gets `400 VALIDATION_FAILED`.
