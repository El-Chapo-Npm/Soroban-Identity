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
