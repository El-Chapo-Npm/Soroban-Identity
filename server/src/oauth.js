/**
 * OAuth 2.0 authorization server (#744)
 *
 * A minimal RFC 6749 authorization server scoped to this API's needs:
 * dynamic client registration, the authorization code grant (plus refresh),
 * token introspection (RFC 7662) and revocation (RFC 7009).
 *
 * There is no hosted login/consent page. The resource owner is whoever the
 * request is already authenticated as (via `requireAuth`, i.e. an existing
 * API key) — `/oauth/authorize` treats that identity's own scopes as the
 * ceiling a client can ever be granted, so approving a client can never
 * escalate privilege beyond what the approver already holds.
 *
 * Tokens are stored hashed (SHA-256), the same treatment API keys get, so a
 * leaked store file does not hand out live credentials.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeAtomic, recoverOrphanedFile } from './storage.js';
import { logger } from './logger.js';
import { API_SCOPES } from './validation.js';

export const OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'];

const DEFAULT_AUTH_CODE_TTL_MS = 60 * 1000;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function randomToken(prefix, bytes = 32) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against a same-length dummy so the mismatch is not observable
    // via timing.
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Thrown for every client-facing OAuth failure; `code` is an RFC 6749 error code. */
export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
  }
}

/** Parse a space-delimited scope string into a deduplicated array. */
export function parseScope(scope) {
  if (!scope) return [];
  return [...new Set(String(scope).split(/\s+/).filter(Boolean))];
}

export class OAuthService {
  constructor(config = {}) {
    this.config = config;
    this.storePath = config.oauthStorePath
      ? path.resolve(config.oauthStorePath)
      : path.join(config.dataDir || path.resolve(process.cwd(), 'data'), 'oauth-store.json');

    this.authCodeTtlMs = config.oauthAuthCodeTtlMs ?? DEFAULT_AUTH_CODE_TTL_MS;
    this.accessTokenTtlMs = config.oauthAccessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
    this.refreshTokenTtlMs = config.oauthRefreshTokenTtlMs ?? DEFAULT_REFRESH_TOKEN_TTL_MS;

    this.clients = new Map();
    this.authCodes = new Map();
    this.accessTokens = new Map();
    this.refreshTokens = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });
      await recoverOrphanedFile(this.storePath);
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const record of parsed.clients ?? []) this.clients.set(record.clientId, record);
      for (const record of parsed.accessTokens ?? []) this.accessTokens.set(record.hashedToken, record);
      for (const record of parsed.refreshTokens ?? []) this.refreshTokens.set(record.hashedToken, record);
      // Authorization codes are single-use and short-lived; persisting them
      // across a restart adds risk without real benefit, so only the
      // longer-lived clients and tokens survive a reload.
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ error: err.message, path: this.storePath }, 'Could not read OAuth store file');
      }
    }
    this.loaded = true;
  }

  async persist() {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const payload = JSON.stringify(
      {
        clients: Array.from(this.clients.values()),
        accessTokens: Array.from(this.accessTokens.values()),
        refreshTokens: Array.from(this.refreshTokens.values()),
      },
      null,
      2,
    );
    await writeAtomic(this.storePath, payload);
  }

  _pruneExpired() {
    const now = Date.now();
    for (const [code, record] of this.authCodes) {
      if (record.expiresAt < now) this.authCodes.delete(code);
    }
  }

  /**
   * Register a new OAuth client.
   * @returns {Promise<object>} The client_secret is returned only here — it
   *   is never retrievable again, matching ApiKeyService's issueKey.
   */
  async registerClient({ name, redirectUris, scopes = [], grantTypes = OAUTH_GRANT_TYPES } = {}) {
    await this.load();

    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new OAuthError('invalid_request', 'At least one redirect_uri is required.');
    }
    const invalidGrant = grantTypes.find((g) => !OAUTH_GRANT_TYPES.includes(g));
    if (invalidGrant) {
      throw new OAuthError('invalid_request', `Unsupported grant_type: ${invalidGrant}`);
    }
    const invalidScope = scopes.find((s) => !API_SCOPES.includes(s));
    if (invalidScope) {
      throw new OAuthError('invalid_scope', `Unknown scope: ${invalidScope}`);
    }

    const clientId = randomToken('client', 12);
    const rawSecret = randomToken('secret', 32);
    const record = {
      clientId,
      hashedSecret: hashToken(rawSecret),
      name: name || 'unnamed-client',
      redirectUris,
      scopes: scopes.length > 0 ? scopes : ['credentials:read'],
      grantTypes,
      status: 'active',
      createdAt: Date.now(),
    };

    this.clients.set(clientId, record);
    await this.persist();

    return {
      clientId,
      clientSecret: rawSecret,
      name: record.name,
      redirectUris: record.redirectUris,
      scopes: record.scopes,
      grantTypes: record.grantTypes,
      createdAt: new Date(record.createdAt).toISOString(),
    };
  }

  async getClient(clientId) {
    await this.load();
    return this.clients.get(clientId) ?? null;
  }

  async listClients() {
    await this.load();
    return Array.from(this.clients.values()).map(({ hashedSecret, ...rest }) => ({
      ...rest,
      createdAt: new Date(rest.createdAt).toISOString(),
    }));
  }

  async _requireClient(clientId, clientSecret) {
    const client = await this.getClient(clientId);
    if (!client || client.status !== 'active') {
      throw new OAuthError('invalid_client', 'Unknown or inactive client.', 401);
    }
    if (!timingSafeEqualStrings(hashToken(clientSecret ?? ''), client.hashedSecret)) {
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    }
    return client;
  }

  /**
   * Resource-owner approval step of the authorization code grant.
   *
   * `ownerScopes` is the scope set of the already-authenticated caller
   * approving the client (see module doc) — every requested scope must be
   * within it, and within the client's own registered scopes.
   */
  async authorize({ clientId, redirectUri, scope, state, subject, ownerScopes = [] }) {
    await this.load();
    this._pruneExpired();

    const client = await this.getClient(clientId);
    if (!client || client.status !== 'active') {
      throw new OAuthError('invalid_client', 'Unknown or inactive client.');
    }
    if (!client.redirectUris.includes(redirectUri)) {
      // Never redirect to an unregistered URI — this check must fail closed
      // with a direct error rather than a redirect.
      throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client.');
    }
    if (!client.grantTypes.includes('authorization_code')) {
      throw new OAuthError('unauthorized_client', 'Client is not authorized to use the authorization_code grant.');
    }

    const requestedScopes = parseScope(scope);
    const effectiveScopes = requestedScopes.length > 0 ? requestedScopes : client.scopes;
    const hasWildcardOwner = ownerScopes.includes('*');
    const outOfClientScope = effectiveScopes.find((s) => !client.scopes.includes('*') && !client.scopes.includes(s));
    if (outOfClientScope) {
      throw new OAuthError('invalid_scope', `Scope '${outOfClientScope}' is not registered for this client.`);
    }
    const outOfOwnerScope = effectiveScopes.find((s) => !hasWildcardOwner && !ownerScopes.includes(s));
    if (outOfOwnerScope) {
      throw new OAuthError('invalid_scope', `Approving identity does not hold scope '${outOfOwnerScope}'.`, 403);
    }

    const code = randomToken('ac', 24);
    this.authCodes.set(code, {
      code,
      clientId,
      redirectUri,
      scope: effectiveScopes.join(' '),
      subject: subject ?? null,
      expiresAt: Date.now() + this.authCodeTtlMs,
      used: false,
    });

    return { code, redirectUri, state: state ?? null };
  }

  async _issueTokenPair({ clientId, scope, subject }) {
    const now = Date.now();
    const rawAccessToken = randomToken('at');
    const rawRefreshToken = randomToken('rt');

    const accessRecord = {
      hashedToken: hashToken(rawAccessToken),
      clientId,
      scope,
      subject: subject ?? null,
      tokenType: 'access_token',
      issuedAt: now,
      expiresAt: now + this.accessTokenTtlMs,
      revoked: false,
    };
    const refreshRecord = {
      hashedToken: hashToken(rawRefreshToken),
      clientId,
      scope,
      subject: subject ?? null,
      tokenType: 'refresh_token',
      issuedAt: now,
      expiresAt: now + this.refreshTokenTtlMs,
      revoked: false,
    };

    this.accessTokens.set(accessRecord.hashedToken, accessRecord);
    this.refreshTokens.set(refreshRecord.hashedToken, refreshRecord);
    await this.persist();

    return {
      access_token: rawAccessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTokenTtlMs / 1000),
      refresh_token: rawRefreshToken,
      scope,
    };
  }

  /** Exchange an authorization code for an access + refresh token pair. */
  async exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri }) {
    await this.load();
    this._pruneExpired();
    await this._requireClient(clientId, clientSecret);

    const record = this.authCodes.get(code);
    if (!record || record.used || record.expiresAt < Date.now()) {
      throw new OAuthError('invalid_grant', 'Authorization code is invalid, expired, or already used.');
    }
    if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
      throw new OAuthError('invalid_grant', 'Authorization code does not match client_id or redirect_uri.');
    }

    // One-time use: remove immediately so a replayed code can never succeed
    // twice, even under concurrent requests racing this check.
    this.authCodes.delete(code);

    return this._issueTokenPair({ clientId, scope: record.scope, subject: record.subject });
  }

  /** Exchange a refresh token for a new access + refresh token pair (rotation). */
  async exchangeRefreshToken({ refreshToken, clientId, clientSecret, scope }) {
    await this.load();
    await this._requireClient(clientId, clientSecret);

    const hashed = hashToken(refreshToken ?? '');
    const record = this.refreshTokens.get(hashed);
    if (!record || record.revoked || record.expiresAt < Date.now()) {
      throw new OAuthError('invalid_grant', 'Refresh token is invalid, expired, or revoked.');
    }
    if (record.clientId !== clientId) {
      throw new OAuthError('invalid_grant', 'Refresh token does not belong to this client.');
    }

    const grantedScopes = parseScope(record.scope);
    let effectiveScope = record.scope;
    if (scope) {
      // RFC 6749 §6: the new scope may only narrow, never widen, the
      // original grant.
      const requested = parseScope(scope);
      const escalated = requested.find((s) => !grantedScopes.includes(s));
      if (escalated) {
        throw new OAuthError('invalid_scope', `Cannot widen scope with '${escalated}' on refresh.`);
      }
      effectiveScope = requested.join(' ');
    }

    // Rotate: the presented refresh token is single-use going forward, so a
    // stolen-then-replayed token is caught the next time the legitimate
    // client rotates it.
    record.revoked = true;

    return this._issueTokenPair({ clientId, scope: effectiveScope, subject: record.subject });
  }

  /** RFC 7662 token introspection. */
  async introspect(token, { clientId, clientSecret } = {}) {
    await this.load();
    if (clientId) await this._requireClient(clientId, clientSecret);

    const hashed = hashToken(token ?? '');
    const record = this.accessTokens.get(hashed) ?? this.refreshTokens.get(hashed);
    if (!record || record.revoked || record.expiresAt < Date.now()) {
      return { active: false };
    }

    return {
      active: true,
      scope: record.scope,
      client_id: record.clientId,
      token_type: record.tokenType === 'refresh_token' ? 'refresh_token' : 'Bearer',
      exp: Math.floor(record.expiresAt / 1000),
      iat: Math.floor(record.issuedAt / 1000),
      sub: record.subject ?? undefined,
    };
  }

  /** RFC 7009 token revocation. Always reports success once the client itself is valid, per spec. */
  async revoke(token, { clientId, clientSecret } = {}) {
    await this.load();
    if (clientId) await this._requireClient(clientId, clientSecret);

    const hashed = hashToken(token ?? '');
    let changed = false;
    for (const store of [this.accessTokens, this.refreshTokens]) {
      const record = store.get(hashed);
      if (record && !record.revoked) {
        record.revoked = true;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  /**
   * Validate a bearer access token for use as request authentication,
   * mirroring the shape ApiKeyService.validateKey returns so `requireAuth`
   * can treat the two interchangeably.
   */
  async validateAccessToken(rawToken) {
    if (!rawToken) return null;
    await this.load();
    const hashed = hashToken(rawToken);
    const record = this.accessTokens.get(hashed);
    if (!record || record.revoked || record.expiresAt < Date.now()) return null;
    return {
      id: record.clientId,
      scopes: parseScope(record.scope),
      tier: 'oauth',
      oauth: true,
      subject: record.subject,
    };
  }
}
