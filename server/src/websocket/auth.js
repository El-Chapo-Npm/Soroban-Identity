/**
 * WebSocket connection authentication (#885).
 *
 * A WebSocket upgrade cannot carry custom headers from a browser, so the JWT
 * may arrive as `?token=` (or `?access_token=`), as a `Sec-WebSocket-Protocol`
 * subprotocol entry (`bearer.<jwt>`), or as an `Authorization: Bearer` header.
 *
 * The token is validated *before* the handshake completes: an unauthorized
 * client is answered with a plain HTTP 401/403 and never becomes a WebSocket.
 * A connection that is accepted still has to complete the application-level
 * handshake (`hello` -> `ready`) within `handshakeTimeoutMs`, otherwise it is
 * closed with `CLOSE_UNAUTHORIZED`.
 *
 * Every authentication decision is logged as a structured `ws.auth` event.
 */

import { logger } from '../logger.js';
import { checkJwtExpiry } from '../app.js';

/** Close code sent when a client fails or skips the handshake. */
export const CLOSE_HANDSHAKE_TIMEOUT = 4008;

/** Subprotocol prefix used to carry a bearer token. */
export const BEARER_SUBPROTOCOL_PREFIX = 'bearer.';

/** Default time a client has to send `hello` after the upgrade. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Default token-bucket size for inbound messages, per connection. */
export const DEFAULT_CONNECTION_RATE_LIMIT = 60;

/** Default token-bucket window for inbound messages, per connection. */
export const DEFAULT_CONNECTION_RATE_WINDOW_MS = 60_000;

/**
 * Extract the bearer token from an upgrade request.
 *
 * Precedence: `Authorization` header, `Sec-WebSocket-Protocol` subprotocol,
 * then the `token` / `access_token` query parameters.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @returns {{token: string, source: string}}
 */
export function extractToken(req, url) {
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string' && /^Bearer\s+/i.test(authorization)) {
    return { token: authorization.replace(/^Bearer\s+/i, '').trim(), source: 'authorization_header' };
  }

  const protocols = String(req.headers?.['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const protocol of protocols) {
    if (protocol.toLowerCase().startsWith(BEARER_SUBPROTOCOL_PREFIX)) {
      return {
        token: protocol.slice(BEARER_SUBPROTOCOL_PREFIX.length),
        source: 'subprotocol',
      };
    }
  }

  const queryToken = url?.searchParams?.get('token') ?? url?.searchParams?.get('access_token');
  if (queryToken) return { token: queryToken, source: 'query' };

  return { token: '', source: 'none' };
}

/**
 * Validate a JWT for a WebSocket connection.
 *
 * Signature verification is delegated to `verifySignature` when supplied (the
 * HTTP layer already owns key material); the `exp` claim is always checked.
 *
 * @param {string} token
 * @param {object} [options]
 * @param {(token: string) => (boolean|Promise<boolean>)} [options.verifySignature]
 * @param {number} [options.clockSkewSeconds]
 * @param {number} [options.now]
 * @returns {Promise<{ok: true, claims: object}|{ok: false, reason: string}>}
 */
export async function validateJwt(token, { verifySignature, clockSkewSeconds = 30, now = Date.now() } = {}) {
  if (!token) return { ok: false, reason: 'missing_token' };

  if (typeof verifySignature === 'function') {
    let signatureOk = false;
    try {
      signatureOk = await verifySignature(token);
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return { ok: false, reason: 'invalid_signature' };
  }

  const expiry = checkJwtExpiry(token, { clockSkewSeconds, now });
  if (!expiry.ok) return { ok: false, reason: expiry.code.toLowerCase() };

  const parts = token.split('.');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'invalid_token' };

  return { ok: true, claims };
}

/**
 * Authenticate an upgrade request and log the outcome.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @param {object} [options]
 * @param {(token: string) => (boolean|Promise<boolean>)} [options.verifySignature]
 * @param {number} [options.now]
 * @returns {Promise<{ok: true, auth: object}|{ok: false, reason: string, status: number}>}
 */
export async function authenticateConnection(req, url, { verifySignature, now } = {}) {
  const { token, source } = extractToken(req, url);
  const result = await validateJwt(token, { verifySignature, now });

  if (!result.ok) {
    const status = result.reason === 'insufficient_scope' ? 403 : 401;
    logger.warn(
      { event: 'ws.auth', outcome: 'rejected', reason: result.reason, source, remoteAddress: req.socket?.remoteAddress },
      'WebSocket authentication rejected',
    );
    return { ok: false, reason: result.reason, status };
  }

  const auth = {
    subject: result.claims.sub ?? null,
    scopes: Array.isArray(result.claims.scope)
      ? result.claims.scope
      : String(result.claims.scope ?? '').split(' ').filter(Boolean),
    expiresAt: result.claims.exp,
    source,
  };

  logger.info(
    { event: 'ws.auth', outcome: 'accepted', subject: auth.subject, source, remoteAddress: req.socket?.remoteAddress },
    'WebSocket authentication accepted',
  );

  return { ok: true, auth };
}

/**
 * Per-connection token bucket for inbound messages.
 */
export class ConnectionRateLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.windowMs]
   * @param {() => number} [options.now]
   */
  constructor({ limit = DEFAULT_CONNECTION_RATE_LIMIT, windowMs = DEFAULT_CONNECTION_RATE_WINDOW_MS, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.tokens = limit;
    this.updatedAt = now();
  }

  /** @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}} */
  consume(cost = 1) {
    const current = this.now();
    const elapsed = current - this.updatedAt;
    if (elapsed > 0) {
      this.tokens = Math.min(this.limit, this.tokens + (elapsed / this.windowMs) * this.limit);
      this.updatedAt = current;
    }
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true, remaining: Math.floor(this.tokens), retryAfterSeconds: 0 };
    }
    const deficit = cost - this.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((deficit / this.limit) * (this.windowMs / 1000))),
    };
  }
}

/**
 * Track the application-level handshake for one connection.
 *
 * The client must send `{type: 'hello'}` (optionally with `token` to refresh
 * credentials) before any other message; the server answers `{type: 'ready'}`.
 */
export class HandshakeState {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({ timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS, now = Date.now } = {}) {
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.startedAt = now();
    this.completed = false;
  }

  /** @returns {boolean} */
  get expired() {
    return !this.completed && this.now() - this.startedAt > this.timeoutMs;
  }

  /** @returns {boolean} True the first time the handshake completes. */
  complete() {
    if (this.completed) return false;
    this.completed = true;
    return true;
  }
}
