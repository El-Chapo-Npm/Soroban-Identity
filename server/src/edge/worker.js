/**
 * Edge functions for Cloudflare Workers (#1115).
 *
 * Handles credential verification, cached DID resolution, rate limiting, bot
 * detection, A/B routing and analytics close to the user. Everything else is
 * proxied to the nearest regional origin (geo-routing).
 *
 * The module keeps no top-level async work so cold starts stay minimal.
 */

const DID_CACHE_TTL_SECONDS = 300;
const BOT_PATTERN = /(bot|crawler|spider|curl|wget|python-requests|httpclient|headless)/i;
const rateBuckets = new Map();

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

export function rateLimit(request, env, now = Date.now()) {
  const limit = Math.max(1, Number(env.EDGE_REQUESTS_PER_MINUTE || 300));
  const window = Math.floor(now / 60000);
  const key = `${clientIp(request)}:${window}`;
  const count = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, count);
  if (rateBuckets.size > 10000) {
    for (const bucket of rateBuckets.keys()) if (!bucket.endsWith(`:${window}`)) rateBuckets.delete(bucket);
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
}

export function resetRateLimits() {
  rateBuckets.clear();
}

export function isBot(request) {
  const ua = request.headers.get('user-agent') || '';
  const score = request.cf?.botManagement?.score;
  if (typeof score === 'number') return score < 30;
  return !ua || BOT_PATTERN.test(ua);
}

/** Sticky A/B bucket derived from a cookie or a stable hash of the client IP. */
export function abVariant(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)ab_variant=(a|b)/);
  if (match) return match[1];
  const pct = Math.min(100, Math.max(0, Number(env.AB_TEST_PERCENTAGE ?? 50)));
  let hash = 0;
  for (const ch of clientIp(request)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 100 < pct ? 'b' : 'a';
}

/** Pick the origin for the request's continent, falling back to the default. */
export function selectOrigin(request, env, variant = 'a') {
  if (variant === 'b' && env.ORIGIN_VARIANT_B) return env.ORIGIN_VARIANT_B;
  let regions = {};
  try {
    regions = env.ORIGIN_REGIONS ? JSON.parse(env.ORIGIN_REGIONS) : {};
  } catch {
    regions = {};
  }
  const continent = request.cf?.continent;
  const origin = (continent && regions[continent]) || env.ORIGIN_URL;
  if (!origin) throw new Error('ORIGIN_URL is not configured');
  return origin;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Verify a compact JWS (HS256) credential at the edge using
 * `env.CREDENTIAL_VERIFY_SECRET`. Checks signature, `exp` and `nbf`.
 */
export async function verifyCredential(token, env, now = Date.now()) {
  if (typeof token !== 'string') return { valid: false, reason: 'missing_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  if (!env.CREDENTIAL_VERIFY_SECRET) return { valid: false, reason: 'not_configured' };
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (header.alg !== 'HS256') return { valid: false, reason: 'unsupported_alg' };
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.CREDENTIAL_VERIFY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return { valid: false, reason: 'bad_signature' };
  const seconds = Math.floor(now / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= seconds) return { valid: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > seconds) return { valid: false, reason: 'not_yet_valid' };
  return { valid: true, claims: payload };
}

/** Resolve a DID through the origin, caching the document at the edge. */
export async function resolveDid(did, request, env, ctx, cache = globalThis.caches?.default) {
  const origin = selectOrigin(request, env);
  const url = `${origin.replace(/\/+$/, '')}/dids/${encodeURIComponent(did)}`;
  const cacheKey = new Request(url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('x-edge-cache', 'HIT');
      return res;
    }
  }
  const upstream = await fetch(url, { headers: { accept: 'application/json' } });
  const res = new Response(upstream.body, upstream);
  res.headers.set('cache-control', `public, max-age=${Number(env.DID_CACHE_TTL_SECONDS || DID_CACHE_TTL_SECONDS)}`);
  res.headers.set('x-edge-cache', 'MISS');
  if (cache && upstream.ok) ctx?.waitUntil?.(cache.put(cacheKey, res.clone()));
  return res;
}

/** Fire-and-forget analytics event to Workers Analytics Engine, if bound. */
export function recordAnalytics(env, request, { route, status, durationMs }) {
  env.EDGE_ANALYTICS?.writeDataPoint?.({
    blobs: [route, request.cf?.colo || 'unknown', request.cf?.country || 'unknown'],
    doubles: [status, durationMs],
    indexes: [route],
  });
}

export async function handleRequest(request, env, ctx) {
  const started = Date.now();
  const url = new URL(request.url);
  let route = 'proxy';
  let response;

  if (env.BOT_DETECTION !== 'off' && isBot(request) && !url.pathname.startsWith('/health')) {
    route = 'bot';
    response = json({ error: 'bot_detected' }, 403);
  } else {
    const limit = rateLimit(request, env, started);
    if (!limit.allowed) {
      route = 'rate_limited';
      response = json({ error: 'rate_limited' }, 429, { 'retry-after': '60', 'x-ratelimit-limit': String(limit.limit) });
    } else if (url.pathname === '/edge/verify' && request.method === 'POST') {
      route = 'verify';
      const body = await request.json().catch(() => ({}));
      const result = await verifyCredential(body.credential, env);
      response = json(result, result.valid ? 200 : 422);
    } else if (url.pathname.startsWith('/edge/dids/') && request.method === 'GET') {
      route = 'did';
      response = await resolveDid(decodeURIComponent(url.pathname.slice('/edge/dids/'.length)), request, env, ctx);
    } else {
      const variant = abVariant(request, env);
      const target = new URL(url.pathname + url.search, selectOrigin(request, env, variant));
      const upstream = await fetch(new Request(target, request));
      response = new Response(upstream.body, upstream);
      response.headers.append('set-cookie', `ab_variant=${variant}; Path=/; Max-Age=2592000; Secure; SameSite=Lax`);
      response.headers.set('x-ab-variant', variant);
    }
  }

  response.headers.set('x-edge-colo', request.cf?.colo || 'unknown');
  recordAnalytics(env, request, { route, status: response.status, durationMs: Date.now() - started });
  return response;
}

export default { fetch: handleRequest };
