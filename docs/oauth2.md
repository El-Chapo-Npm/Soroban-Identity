# OAuth 2.0 Authorization Server

## Overview

The server exposes a minimal [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749) authorization server for third-party integrations that need scoped, expiring, revocable credentials instead of a long-lived API key: dynamic client registration, the authorization code grant (with refresh), [token introspection](https://www.rfc-editor.org/rfc/rfc7662) (RFC 7662), and [token revocation](https://www.rfc-editor.org/rfc/rfc7009) (RFC 7009).

Scopes are the same set used by [API keys](./api-key-scopes.md) (`credentials:read`, `credentials:write`, `admin:read`, `admin:write`, `*`), and an OAuth access token authenticates exactly like an API key everywhere `requireAuth` is used — `req.apiKeyScopes` is populated the same way either way.

There is no hosted login/consent page. The "resource owner" approving a client at `/oauth/authorize` is whoever the request is already authenticated as (via an existing API key or a prior OAuth token). A requested scope can never exceed both the client's own registered scopes and the approving identity's scopes — approving a client can never grant it more than the approver already holds.

## 1. Register a client

```bash
curl -X POST http://localhost:3001/oauth/clients \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Partner Dashboard",
    "redirectUris": ["https://partner.example.com/callback"],
    "scopes": ["credentials:read"]
  }'
```

```json
{
  "clientId": "client_...",
  "clientSecret": "secret_...",
  "name": "Partner Dashboard",
  "redirectUris": ["https://partner.example.com/callback"],
  "scopes": ["credentials:read"],
  "grantTypes": ["authorization_code", "refresh_token"],
  "createdAt": "2026-08-28T00:00:00.000Z"
}
```

`clientSecret` is only ever returned here — it is stored hashed (SHA-256), the same treatment as API keys. Requires `admin:write`.

## 2. Authorize

```
GET /oauth/authorize?response_type=code&client_id=client_...&redirect_uri=https://partner.example.com/callback&scope=credentials:read&state=xyz
```

Authenticate the same way as any other endpoint (`X-API-Key` or `Authorization: Bearer`). On success the server redirects (`302`) to `redirect_uri` with `code` and `state` query parameters. `redirect_uri` must exactly match one of the client's registered URIs — a mismatch is answered directly with a `400` JSON error rather than a redirect, so a caller can never be bounced to an un-vetted URL.

## 3. Exchange the code for tokens

```bash
curl -X POST http://localhost:3001/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "ac_...",
    "redirect_uri": "https://partner.example.com/callback",
    "client_id": "client_...",
    "client_secret": "secret_..."
  }'
```

```json
{
  "access_token": "at_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_...",
  "scope": "credentials:read"
}
```

Codes are single-use and expire quickly (`OAUTH_AUTH_CODE_TTL_MS`, default 60s). Note this endpoint accepts a JSON body rather than RFC 6749's `application/x-www-form-urlencoded`, to match the rest of this API.

## 4. Refresh

```bash
curl -X POST http://localhost:3001/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "refresh_token", "refresh_token": "rt_...", "client_id": "client_...", "client_secret": "secret_..."}'
```

Refresh tokens rotate on every use — the response contains a new access *and* refresh token, and the old refresh token stops working immediately. An optional `scope` may narrow (never widen) the original grant.

## 5. Introspect

```bash
curl -X POST http://localhost:3001/oauth/introspect \
  -H "Content-Type: application/json" \
  -d '{"token": "at_...", "client_id": "client_...", "client_secret": "secret_..."}'
```

```json
{ "active": true, "scope": "credentials:read", "client_id": "client_...", "token_type": "Bearer", "exp": 1893456000, "iat": 1893452400 }
```

Callers authenticate either as the client the token was issued to, or as an admin (`admin:read`). An inactive/unknown/expired token returns `{"active": false}` — never an error, per RFC 7662.

## 6. Revoke

```bash
curl -X POST http://localhost:3001/oauth/revoke \
  -H "Content-Type: application/json" \
  -d '{"token": "at_...", "client_id": "client_...", "client_secret": "secret_..."}'
```

Always responds `200` once the caller's own credentials check out, whether or not the token was recognized (RFC 7009) — this endpoint cannot be used to probe for valid tokens.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OAUTH_STORE_PATH` | `<DATA_DIR>/oauth-store.json` | Where clients and tokens (hashed) are persisted |
| `OAUTH_AUTH_CODE_TTL_MS` | `60000` | Authorization code lifetime |
| `OAUTH_ACCESS_TOKEN_TTL_MS` | `3600000` | Access token lifetime |
| `OAUTH_REFRESH_TOKEN_TTL_MS` | `2592000000` | Refresh token lifetime (30 days) |
