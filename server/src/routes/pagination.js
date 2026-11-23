import { paginateCursor } from "../expiry.js";

/**
 * Standard pagination metadata for list endpoints (#944).
 *
 * Every list response carries a `pagination` object:
 *
 *   {
 *     total_count,  // items matching the query across all pages (null if unknown)
 *     page_size,    // effective page size after clamping
 *     has_more,     // true when another page exists after this one
 *     next_cursor,  // opaque cursor for the next page (cursor endpoints), else null
 *     prev_cursor,  // opaque cursor for the previous page (cursor endpoints), else null
 *     // offset endpoints only:
 *     offset, page, total_pages
 *   }
 *
 * plus an RFC 8288 `Link` header with `next` / `prev` (and `first` / `last`
 * for offset pagination). Existing response fields are kept for backwards
 * compatibility. See docs/cursor-pagination.md.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(value, { fallback = DEFAULT_PAGE_SIZE, max = MAX_PAGE_SIZE } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function clampOffset(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Cursor pagination over an in-memory list, with standard metadata. */
export function cursorPage(items, { limit, cursor = null, direction = "next" } = {}) {
  const pageSize = clampPageSize(limit);
  const { items: page, nextCursor, previousCursor } = paginateCursor(items, {
    limit: pageSize,
    cursor,
    direction,
  });
  return {
    items: page,
    nextCursor,
    previousCursor,
    pagination: {
      total_count: items.length,
      page_size: pageSize,
      has_more: Boolean(nextCursor),
      next_cursor: nextCursor,
      prev_cursor: previousCursor,
    },
  };
}

/** Offset/limit pagination over an in-memory list, with standard metadata. */
export function offsetPage(items, { limit, offset = 0, maxPageSize = MAX_PAGE_SIZE } = {}) {
  const pageSize = clampPageSize(limit, { max: maxPageSize });
  const start = clampOffset(offset);
  const page = items.slice(start, start + pageSize);
  return {
    items: page,
    pagination: offsetMeta({ totalCount: items.length, pageSize, offset: start }),
  };
}

/** Metadata for an offset page when the caller already sliced the data. */
export function offsetMeta({ totalCount, pageSize, offset }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  return {
    total_count: totalCount,
    page_size: pageSize,
    has_more: offset + pageSize < totalCount,
    next_cursor: null,
    prev_cursor: null,
    offset,
    page: Math.floor(offset / pageSize) + 1,
    total_pages: totalPages,
  };
}

/** Adapt the result of expiry.js `paginate()` (1-based page numbers). */
export function pageNumberMeta({ page, pageSize, totalItems, totalPages, hasNextPage }) {
  return {
    total_count: totalItems,
    page_size: pageSize,
    has_more: hasNextPage,
    next_cursor: null,
    prev_cursor: null,
    offset: (page - 1) * pageSize,
    page,
    total_pages: totalPages,
  };
}

function withParams(url, params) {
  const u = new URL(url.pathname + url.search, "http://placeholder");
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  return `${u.pathname}${u.search}`;
}

/**
 * Build the `Link` header value for a page. Relative URLs keep the header
 * correct behind proxies and path-versioning rewrites.
 *
 * Offset endpoints use `offsetParam` ("offset" or "page") to decide how the
 * page position is expressed in the links.
 */
export function buildLinkHeader(url, pagination, { offsetParam = "offset", limitParam = "limit" } = {}) {
  const links = [];
  const add = (rel, params) => links.push(`<${withParams(url, params)}>; rel="${rel}"`);
  const size = pagination.page_size;

  if (pagination.next_cursor || pagination.prev_cursor) {
    if (pagination.next_cursor) add("next", { cursor: pagination.next_cursor, direction: null, [limitParam]: size });
    if (pagination.prev_cursor) add("prev", { cursor: pagination.prev_cursor, direction: "prev", [limitParam]: size });
    add("first", { cursor: null, direction: null, [limitParam]: size });
    return links.join(", ");
  }

  if (pagination.offset === undefined) return links.join(", ");

  const pos = (offset) =>
    offsetParam === "page"
      ? { page: Math.floor(offset / size) + 1, [limitParam]: size }
      : { offset, [limitParam]: size };
  const lastOffset = (pagination.total_pages - 1) * size;

  add("first", pos(0));
  if (pagination.offset > 0) add("prev", pos(Math.max(0, pagination.offset - size)));
  if (pagination.has_more) add("next", pos(pagination.offset + size));
  add("last", pos(lastOffset));
  return links.join(", ");
}

/** Set `Link` (when non-empty) and `X-Total-Count` headers. */
export function setPaginationHeaders(res, url, pagination, options) {
  const link = buildLinkHeader(url, pagination, options);
  if (link) res.setHeader("Link", link);
  if (pagination.total_count !== null && pagination.total_count !== undefined) {
    res.setHeader("X-Total-Count", String(pagination.total_count));
  }
}
