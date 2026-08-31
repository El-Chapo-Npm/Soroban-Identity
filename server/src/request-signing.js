/**
 * HMAC request signing (#752)
 *
 * Signing proves two things an API key alone cannot: that the request body
 * arrived exactly as it was sent, and that a captured request cannot be
 * replayed later. A bearer key is enough to authenticate the *caller*, but
 * anyone who records the request can resend it verbatim; binding a timestamp
 * and a single-use nonce into the signature closes that window.
 *
 * ## Canonical string
 *
 * The client and server independently build the same string and HMAC it. The
 * pieces are joined with newlines, in this fixed order:
 *
 *     <METHOD>\n<PATH_WITH_QUERY>\n<TIMESTAMP>\n<NONCE>\n<SHA256_HEX(body)>
 *
 * Every component is covered: swapping the method, retargeting the path,
 * replaying with a new timestamp or mutating a single byte of the body all
 * produce a different digest. The body is hashed rather than concatenated so
 * the canonical string stays small and binary-safe. An empty body hashes as
 * the SHA-256 of the empty string, so GET and DELETE are signed the same way
 * as a POST.
 *
 * ## Wire format
 *
 *     X-Signature:           v1=<hex hmac-sha256>
 *     X-Signature-Timestamp: <unix seconds>
 *     X-Signature-Nonce:     <unique per request>
 *     X-Signature-Key-Id:    <api key id>   (optional, see below)
 *
 * The version prefix means a future scheme can be introduced without
 * ambiguity: a `v2=` signature is rejected by this verifier rather than being
 * silently compared against a v1 digest.
 *
 * The key id header is optional — when it is absent the API key presented for
 * authentication identifies which signing secret to use. It exists so a
 * caller can sign with a key it is not simultaneously authenticating with.
 */

import crypto from 'node:crypto';

export const SIGNATURE_HEADER = 'x-signature';
export const TIMESTAMP_HEADER = 'x-signature-timestamp';
export const NONCE_HEADER = 'x-signature-nonce';
export const KEY_ID_HEADER = 'x-signature-key-id';

/** Only scheme this verifier accepts. */
export const SIGNATURE_VERSION = 'v1';

/** Requests older (or newer) than this are refused. */
export const DEFAULT_MAX_AGE_SECONDS = 300;

/** Bound on the nonce cache so a flood of signed requests cannot exhaust memory. */
const MAX_TRACKED_NONCES = 100_000;

/**
 * SHA-256 of a request body, hex encoded.
 *
 * @param {Buffer|string} body
 * @returns {string}
 */
export function hashBody(body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Build the string that both sides HMAC.
 *
 * @param {object} parts
 * @param {string} parts.method            - HTTP method; case is normalized
 * @param {string} parts.path              - Path including query string
 * @param {number|string} parts.timestamp  - Unix seconds
 * @param {string} parts.nonce
 * @param {Buffer|string} [parts.body]
 * @returns {string}
 */
export function buildCanonicalString({ method, path, timestamp, nonce, body = '' }) {
  return [
    String(method ?? '').toUpperCase(),
    String(path ?? ''),
    String(timestamp ?? ''),
    String(nonce ?? ''),
    hashBody(body),
  ].join('\n');
}

/**
 * Produce the `X-Signature` header value for a request.
 *
 * Exported for the server's own tests and for the client helpers in
 * `sdk/` — the signing and verifying sides must never drift apart, so they
 * share this one implementation of the canonical form.
 *
 * @param {object} params
 * @param {string} params.secret - Client's signing secret
 * @returns {string} e.g. `v1=9f86d081...`
 */
export function signRequest({ secret, method, path, timestamp, nonce, body = '' }) {
  const canonical = buildCanonicalString({ method, path, timestamp, nonce, body });
  const digest = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return `${SIGNATURE_VERSION}=${digest}`;
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * `timingSafeEqual` throws on a length mismatch, so unequal lengths are
 * reported as a plain mismatch instead — the length of a hex SHA-256 digest
 * is a constant and not a secret.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeHexEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Remembers recently used nonces so a signature cannot be replayed inside its
 * validity window.
 *
 * Entries only need to outlive the freshness window: once a request is too old
 * to pass the timestamp check, its nonce can be forgotten because the
 * timestamp check alone will now reject it. That keeps the store bounded by
 * request rate rather than by uptime.
 */
export class NonceStore {
  /**
   * @param {object}  [options]
   * @param {number}  [options.ttlSeconds=DEFAULT_MAX_AGE_SECONDS]
   * @param {number}  [options.maxEntries=MAX_TRACKED_NONCES]
   * @param {Function} [options.now] - Injectable clock, milliseconds
   */
  constructor({ ttlSeconds = DEFAULT_MAX_AGE_SECONDS, maxEntries = MAX_TRACKED_NONCES, now = Date.now } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
    this.now = now;
    /** @type {Map<string, number>} nonce -> expiry timestamp in ms */
    this.entries = new Map();
  }

  /** Drop every entry whose validity window has passed. */
  prune() {
    const now = this.now();
    for (const [nonce, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(nonce);
    }
  }

  /**
   * Record a nonce, reporting whether it had already been used.
   *
   * @param {string} nonce
   * @param {string} [scope] - Key id, so two clients may pick the same nonce
   * @returns {boolean} True when the nonce is fresh, false when it is a replay
   */
  consume(nonce, scope = '') {
    this.prune();

    const compositeKey = `${scope}:${nonce}`;
    if (this.entries.has(compositeKey)) return false;

    // Pruning already removed everything expired, so a store still at its
    // limit is under genuine load rather than holding stale entries. Refusing
    // the nonce fails the request closed instead of evicting a live entry,
    // which would reopen the replay window it exists to close.
    if (this.entries.size >= this.maxEntries) return false;

    this.entries.set(compositeKey, this.now() + this.ttlMs);
    return true;
  }

  /** Forget every nonce. Intended for tests. */
  clear() {
    this.entries.clear();
  }
}

/**
 * Verify a signed request.
 *
 * Failures are returned rather than thrown, and each carries a machine-usable
 * `code` so the caller can map it to a status code and a client can tell a
 * clock-skew problem apart from a genuinely bad signature.
 *
 * @param {object} params
 * @param {object} params.headers          - Node request headers (lowercased keys)
 * @param {string} params.method
 * @param {string} params.path             - Path including query string
 * @param {Buffer|string} [params.body]    - Exact bytes received
 * @param {string} params.secret           - Signing secret for the calling key
 * @param {NonceStore} params.nonceStore
 * @param {number} [params.maxAgeSeconds]
 * @param {string} [params.scope]          - Key id the nonce is namespaced under
 * @param {Function} [params.now]          - Injectable clock, milliseconds
 * @returns {{ok: true} | {ok: false, code: string, status: number, message: string}}
 */
export function verifySignedRequest({
  headers = {},
  method,
  path,
  body = '',
  secret,
  nonceStore,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  scope = '',
  now = Date.now,
}) {
  const signature = headers[SIGNATURE_HEADER];
  const timestamp = headers[TIMESTAMP_HEADER];
  const nonce = headers[NONCE_HEADER];

  if (!signature || !timestamp || !nonce) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNATURE_REQUIRED',
      message: `Signed requests must send ${SIGNATURE_HEADER}, ${TIMESTAMP_HEADER} and ${NONCE_HEADER}`,
    };
  }

  if (!secret) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNING_KEY_UNKNOWN',
      message: 'No signing secret is registered for this API key',
    };
  }

  const [version, providedDigest] = String(signature).split('=', 2);
  if (version !== SIGNATURE_VERSION || !providedDigest) {
    return {
      ok: false,
      status: 400,
      code: 'SIGNATURE_VERSION_UNSUPPORTED',
      message: `Signature must use the ${SIGNATURE_VERSION} scheme`,
    };
  }

  const timestampSeconds = Number.parseInt(String(timestamp), 10);
  if (!Number.isFinite(timestampSeconds)) {
    return {
      ok: false,
      status: 400,
      code: 'SIGNATURE_TIMESTAMP_INVALID',
      message: `${TIMESTAMP_HEADER} must be a unix timestamp in seconds`,
    };
  }

  // Skew is checked in both directions. A future-dated request is refused too,
  // because accepting one would let a captured signature stay valid for as
  // long as the client cared to post-date it.
  const ageSeconds = Math.floor(now() / 1000) - timestampSeconds;
  if (Math.abs(ageSeconds) > maxAgeSeconds) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNATURE_EXPIRED',
      message: `Signature timestamp is outside the permitted ${maxAgeSeconds}s window`,
    };
  }

  const expected = signRequest({ secret, method, path, timestamp: timestampSeconds, nonce, body });
  const [, expectedDigest] = expected.split('=', 2);

  if (!timingSafeHexEqual(providedDigest, expectedDigest)) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature does not match',
    };
  }

  // The nonce is consumed only after the signature checks out, so an attacker
  // cannot burn a legitimate client's nonces by sending garbage signatures.
  if (!nonceStore.consume(String(nonce), scope)) {
    return {
      ok: false,
      status: 409,
      code: 'SIGNATURE_REPLAYED',
      message: 'This nonce has already been used',
    };
  }

  return { ok: true };
}
