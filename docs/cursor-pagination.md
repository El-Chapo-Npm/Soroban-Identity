# Cursor Pagination

## Overview

`GET /credentials` pages through results using an opaque cursor rather than an offset, so results stay stable even as credentials are issued or revoked between requests.

## Cursor format

A cursor is the base64url encoding of `{"id": "<credential id>"}`. Treat it as opaque — always pass back exactly the string a previous response gave you, in `?cursor=`.

```bash
curl "http://localhost:3001/credentials?limit=25"
```

```json
{
  "items": [ ... ],
  "nextCursor": "eyJpZCI6ImNyZWQtMDI0In0",
  "previousCursor": null
}
```

```bash
curl "http://localhost:3001/credentials?limit=25&cursor=eyJpZCI6ImNyZWQtMDI0In0"
```

An unrecognized or already-deleted cursor id falls back to the first page (`next`) or last page (`prev`) rather than erroring — the credential it pointed at may simply no longer exist. A bare id string (pre-#746 clients) is also accepted as a legacy cursor form.

## Paging backward

Pass `direction=prev` alongside `cursor` to walk backward through the same ordering (results are still returned in forward order, just the page immediately *before* the cursor):

```bash
curl "http://localhost:3001/credentials?limit=25&cursor=<previousCursor>&direction=prev"
```

Every response includes both `nextCursor` and `previousCursor`, so a client can page either direction from any page. Either is `null` when there is nothing further in that direction.

## Limits

`limit` is clamped to `[1, 200]` (default 50).

## Offset pagination (unaffected)

`GET /admin/expiry-report` continues to use classic `page`/`pageSize` offset pagination (`{ page, pageSize, totalItems, totalPages, hasNextPage, items }`) — cursor pagination is additive and does not replace it. Use whichever fits the caller: offset pagination supports jumping to an arbitrary page number; cursor pagination stays correct under concurrent writes.

## Standard pagination metadata

Issue #944. Every list endpoint returns a `pagination` object and pagination headers. It is built by [`server/src/routes/pagination.js`](../server/src/routes/pagination.js). The older top-level fields (`nextCursor`, `previousCursor`, `total`, `page`, and so on) are unchanged, so existing clients keep working.

```json
{
  "items": [ ... ],
  "nextCursor": "eyJpZCI6ImNyZWQtMDI0In0",
  "previousCursor": null,
  "pagination": {
    "total_count": 137,
    "page_size": 25,
    "has_more": true,
    "next_cursor": "eyJpZCI6ImNyZWQtMDI0In0",
    "prev_cursor": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `total_count` | Number of items matching the query across all pages. Also sent as the `X-Total-Count` header. |
| `page_size` | The page size actually used, after clamping to 1–200 (1–500 for audit logs). |
| `has_more` | `true` when another page follows this one. |
| `next_cursor` / `prev_cursor` | Opaque cursors on cursor-paginated endpoints. `null` on offset-paginated endpoints. |
| `offset`, `page`, `total_pages` | Present only on offset-paginated endpoints. |

### Link header

Responses include an RFC 8288 `Link` header whose URLs are relative and keep every other query parameter:

```
Link: </credentials?cursor=eyJpZCI6ImNyZWQtMDI0In0&limit=25>; rel="next", </credentials?limit=25>; rel="first"
```

- Cursor endpoints emit `next`, `prev`, and `first`.
- Offset endpoints emit `first`, `prev`, `next`, and `last`.
- Each link is omitted when there is no such page.

### Endpoints

| Endpoint | Style | Params |
| --- | --- | --- |
| `GET /credentials` | cursor | `limit`, `cursor`, `direction` |
| `GET /webhooks` | offset | `limit` (omit to get the full list), `offset` |
| `GET /webhooks/logs`, `GET /webhooks/:id/logs` | offset | `limit`, `offset` (newest first) |
| `GET /notifications/logs` | offset | `limit`, `offset`. Without `offset`, returns the most recent `limit` entries. |
| `GET /admin/issuers` | offset | `limit` (omit to get the full list), `offset` |
| `GET /admin/expiry-report` | page | `page`, `pageSize` |
| `GET /admin/audit-logs` | offset | `limit`, `offset` |
| `GET /admin/traces` | limit | `limit` |

### Edge cases

- `limit` values that are zero, negative, or not a number fall back to the default page size of 50. Values above the maximum are clamped to it.
- An `offset` past the end returns an empty page with `has_more: false`, and `total_count` still reports the full count.
- An empty collection returns `total_count: 0`, `has_more: false`, and `total_pages: 1`.
- An unknown or deleted cursor restarts from the first page, or from the last page when `direction=prev`, as described above.
