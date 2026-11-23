# Advanced rate limiting

> **Issue:** [SEC-03 #941](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/941)  
> **Scope:** `server/src/middleware/ratelimit-advanced.ts`  
> **Related:** [Security and DDoS incident response](./incident-response.md), [`server/src/rate-limiter.js`](../../server/src/rate-limiter.js)

Advanced rate limiting with multiple strategies and tiers. The system enforces two independent budgets per request — a **per-endpoint** budget and a **per-tier** budget — and denies the request if either is exhausted.

---

## Overview

The `TieredRateLimiter` class (implemented in `server/src/rate-limiter.js`) is the core enforcement engine. The advanced middleware layer at `server/src/middleware/ratelimit-advanced.ts` extends it with:

- Separate per-IP limits (stricter, for unauthenticated traffic)
- Per-user/API-key limits (more lenient, tied to subscription tier)
- Endpoint-specific windows for expensive operations
- Burst allowance for authenticated users
- Rate limit bypass for premium users
- Structured violation logging
- A dashboard-facing metrics endpoint

---

## Request evaluation order

Every incoming request is evaluated in this sequence. The first denial short-circuits the chain.

```
1. Whitelist check (IP exact-match or CIDR)
        ↓ not whitelisted
2. Endpoint budget check (per-client, per-endpoint window)
        ↓ within limit
3. Tier budget check (per-client, read/write, per-tier window)
        ↓ within limit
4. Request is allowed — response headers set
```

---

## Tier definitions

Tier limits apply per 60-second window. Tiers are resolved in priority order: `req.userTier` → `x-user-tier` header → `req.auth.apiKey.tier` → default `free`.

| Tier | Read limit / min | Write limit / min | Notes |
|------|-----------------|-------------------|-------|
| `free` | 60 | 20 | Default for unauthenticated or unknown clients |
| `pro` | 300 | 100 | Authenticated API key holders |
| `enterprise` | 1,200 | 500 | High-volume integrators |

A **read** is any `GET`, `HEAD`, or `OPTIONS` request. All other methods (`POST`, `PUT`, `PATCH`, `DELETE`) count as writes.

### Per-IP limits

Unauthenticated requests are keyed by IP address (`ip:<address>`). These use the `free` tier limits. IP-keyed requests are subject to the same per-endpoint rules as authenticated requests but receive no burst allowance.

When `trustProxy` is enabled the client IP is taken from the leftmost value of `X-Forwarded-For`. Enable this only when the server sits behind a trusted reverse proxy — otherwise it allows clients to spoof their IP.

### Per-user limits

Authenticated requests are keyed by API key ID (`key:<id>`). They inherit the tier attached to the key and qualify for burst allowance (see below).

---

## Endpoint-specific limits

Endpoint rules are evaluated before tier limits and use a 15-minute window. The first matching rule wins; more specific patterns take precedence.

| Rule | Method | Path pattern | Limit / 15 min | Rationale |
|------|--------|--------------|---------------|-----------|
| `credential_issuance` | `POST` | `/credentials`, `/credentials/issue` | 10 | Issuance is computationally expensive and the most likely abuse vector |
| `credential_revocation` | `POST` | `/credentials/:id/revoke` | 20 | Revocation writes to on-chain state |
| `general` | any | `/` (catch-all) | 100 | Baseline for all other endpoints |

Custom endpoint rules can be passed to the `TieredRateLimiter` constructor via the `endpointRules` option.

---

## Burst allowance for authenticated users

Authenticated users (any tier above `free`) receive a burst allowance that permits short-lived traffic spikes without triggering a 429. The allowance is implemented as a larger initial bucket that drains at the tier rate:

- **Pro:** up to 1.5× the per-minute limit in a single burst before the window resets
- **Enterprise:** up to 2× the per-minute limit in a single burst

Burst windows are tracked independently of the rolling per-minute buckets. Once the burst allowance is consumed the client falls back to the standard tier limit for the remainder of the window.

> The burst values above are the planned defaults for `ratelimit-advanced.ts`. The existing `TieredRateLimiter` in `rate-limiter.js` does not yet implement burst; it will be extended by SEC-03.

---

## Premium bypass

Users on a designated `premium` plan (a future tier above `enterprise`) can be granted a full bypass by adding their API key ID to the bypass list in environment configuration. Bypassed keys still appear in violation logs when they would have breached a limit — the bypass is auditable, not invisible.

```
RATE_LIMIT_BYPASS_KEY_IDS=key_abc123,key_def456
```

The bypass list is loaded at startup and can be reloaded without a restart via the `/admin/rate-limit/reload` endpoint (requires `admin` scope).

---

## IP and CIDR whitelist

Static IP addresses or CIDR ranges that should never be rate-limited (e.g. internal health-check probes, CI runners) are configured via:

```
RATE_LIMIT_WHITELIST=10.0.0.0/8,192.168.1.50
```

Both IPv4 exact addresses and CIDR `/N` prefixes are supported. IPv6 exact addresses are supported; IPv6 CIDR is not. Whitelisted traffic is still logged but is never denied.

---

## Violation logging

Every denial emits a structured log entry at `WARN` level via the application logger. The log record includes:

| Field | Description |
|-------|-------------|
| `type` | Always `rate_limit_violation` |
| `scope` | `endpoint` or `tier` — which budget was exhausted |
| `rule` | The endpoint rule name or tier name that triggered the denial |
| `ip` | Resolved client IP |
| `method` | HTTP method |
| `path` | Request path |
| `limit` | The budget that was exhausted |
| `retryAfter` | Seconds until the window resets |
| `apiKeyId` | API key ID if authenticated, otherwise `null` |
| `userAgent` | `User-Agent` header value |

Violations are also counted in the `violations` counter on the limiter instance, which feeds the metrics endpoint.

---

## Response headers

On every request — allowed or denied — the middleware sets standard rate-limit headers based on the most constrained budget:

| Header | Value |
|--------|-------|
| `X-RateLimit-Limit` | Budget ceiling for the current window |
| `X-RateLimit-Remaining` | Requests remaining before the next denial |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds to wait before retrying (only on 429 responses) |

When both an endpoint budget and a tier budget apply, the headers reflect whichever budget has fewer remaining requests.

---

## Dashboard metrics

The `/metrics` endpoint (Prometheus format) exposes the following gauges and counters from the rate limiter:

| Metric | Type | Description |
|--------|------|-------------|
| `rate_limit_active_buckets` | Gauge | Number of in-memory client buckets currently tracked |
| `rate_limit_violations_total` | Counter | Cumulative denied requests since last restart |
| `rate_limit_whitelist_entries` | Gauge | Number of whitelisted IPs/CIDRs |
| `rate_limit_evictions_total` | Counter | Expired buckets removed during eviction passes |

A Grafana dashboard panel showing `rate_limit_violations_total` by `scope` and `rule` provides the rate-limit abuse view described in the issue. See [distributed tracing](../distributed-tracing.md) and [structured logging](../structured-logging.md) for how to correlate violations with trace IDs.

---

## Configuration reference

All values are read from environment variables at startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_TRUST_PROXY` | `false` | Parse `X-Forwarded-For` for client IP |
| `RATE_LIMIT_WHITELIST` | _(empty)_ | Comma-separated IP/CIDR bypass list |
| `RATE_LIMIT_BYPASS_KEY_IDS` | _(empty)_ | Comma-separated API key IDs with full bypass |
| `RATE_LIMIT_MAX_BUCKETS` | `10000` | Maximum in-memory client buckets before eviction |
| `RATE_LIMIT_FREE_READ` | `60` | Free tier read limit per minute |
| `RATE_LIMIT_FREE_WRITE` | `20` | Free tier write limit per minute |
| `RATE_LIMIT_PRO_READ` | `300` | Pro tier read limit per minute |
| `RATE_LIMIT_PRO_WRITE` | `100` | Pro tier write limit per minute |
| `RATE_LIMIT_ENTERPRISE_READ` | `1200` | Enterprise tier read limit per minute |
| `RATE_LIMIT_ENTERPRISE_WRITE` | `500` | Enterprise tier write limit per minute |
| `RATE_LIMIT_ENDPOINT_ISSUANCE` | `10` | Credential issuance limit per 15 min |
| `RATE_LIMIT_ENDPOINT_REVOCATION` | `20` | Credential revocation limit per 15 min |
| `RATE_LIMIT_ENDPOINT_GENERAL` | `100` | General endpoint limit per 15 min |

---

## Implementation notes

- Buckets are stored in a `Map` on the limiter instance. This is sufficient for single-process deployments. For multi-process or horizontally scaled deployments, the bucket store must be moved to Redis using the same key schema (`key:<id>:<tier>:<read|write>` and `key:<id>:endpoint:<rule>`).
- Eviction runs opportunistically on bucket writes when `clients.size >= maxBuckets`. No timer-based cleanup is needed in the current design.
- The `ratelimit-advanced.ts` middleware wraps `TieredRateLimiter` and is registered early in the Express middleware chain, before authentication middleware, so that unauthenticated abuse is blocked before any database work occurs. Authenticated tier resolution happens inside the limiter after the auth middleware has populated `req.auth`.

---

## Related

- [Security and DDoS incident response](./incident-response.md)
- [Structured logging](../structured-logging.md)
- [Distributed tracing](../distributed-tracing.md)
- [API key scopes](../api-key-scopes.md)
- [`server/src/rate-limiter.js`](../../server/src/rate-limiter.js) — current implementation
- [`server/src/middleware/ratelimit-advanced.ts`](../../server/src/middleware/ratelimit-advanced.ts) — SEC-03 target file
