/**
 * ETag support for cache validation and optimistic concurrency (#745).
 *
 * ETags are content hashes (SHA-1 of the canonical JSON form), so two
 * requests for the same resource state always produce the same tag without
 * needing a version counter on every record.
 */

import crypto from 'node:crypto';

/**
 * Compute an ETag for a resource. Strong by default (byte-for-byte identity);
 * pass `weak: true` for a representation that is only "semantically
 * equivalent" (e.g. a paginated collection, whose serialization can vary in
 * ways clients shouldn't care about).
 *
 * @param {unknown} resource
 * @param {{weak?: boolean}} [options]
 * @returns {string} A quoted ETag value, e.g. `"abcd1234"` or `W/"abcd1234"`.
 */
export function computeEtag(resource, { weak = false } = {}) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(resource))
    .digest('hex');
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/** Strip a leading weak-validator prefix so two tags can be compared by opacity value alone. */
function stripWeakPrefix(tag) {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/**
 * Parse a comma-separated If-Match / If-None-Match header into its list of
 * entity tags. Returns `null` for a bare `*` (matches any representation).
 *
 * @param {string|undefined} header
 * @returns {string[]|null}
 */
export function parseEtagHeader(header) {
  if (!header) return [];
  const trimmed = header.trim();
  if (trimmed === '*') return null;
  return trimmed
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Whether `etag` satisfies an If-None-Match header — used to answer 304 on a
 * conditional GET. Per RFC 7232, comparison here is weak (the `W/` prefix is
 * ignored), since If-None-Match is about cache freshness, not identity.
 */
export function matchesIfNoneMatch(header, etag) {
  const tags = parseEtagHeader(header);
  if (tags === null) return true; // bare "*": matches any current representation
  if (tags.length === 0) return false;
  const stripped = stripWeakPrefix(etag);
  return tags.some((tag) => stripWeakPrefix(tag) === stripped);
}

/**
 * Whether `etag` satisfies an If-Match header — used to guard a write against
 * a stale read (optimistic concurrency). Per RFC 7232, this comparison is
 * strong: a weak tag on either side never matches.
 */
export function matchesIfMatch(header, etag) {
  const tags = parseEtagHeader(header);
  if (tags === null) return true; // bare "*": matches any current representation
  if (tags.length === 0) return false;
  if (etag.startsWith('W/')) return false;
  return tags.some((tag) => !tag.startsWith('W/') && tag === etag);
}
