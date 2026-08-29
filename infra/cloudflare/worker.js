const COOKIE_NAME = 'soroban_release';
const buckets = new Map();

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function blockedRegion(request, env) {
  const blocked = String(env.BLOCKED_REGIONS || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  return blocked.includes(String(request.cf?.country || '').toUpperCase());
}

function rateLimit(request, env) {
  const limit = Math.max(1, Number(env.EDGE_REQUESTS_PER_MINUTE || 300));
  const now = Math.floor(Date.now() / 60000);
  const key = `${clientIp(request)}:${now}`;
  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  if (buckets.size > 10000) for (const [bucket] of buckets) if (!bucket.endsWith(`:${now}`)) buckets.delete(bucket);
  return { allowed: count <= limit, count, limit };
}

function percentage(env) {
  const value = Number(env.CANARY_PERCENTAGE ?? 10);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 10;
}

function originUrl(request, env, release) {
  const origin = release === 'canary' ? env.CANARY_ORIGIN : env.STABLE_ORIGIN;
  if (!origin) throw new Error(`${release.toUpperCase()}_ORIGIN is not configured`);
  const url = new URL(request.url);
  return new URL(`${url.pathname}${url.search}`, origin);
}

function releaseFromCookie(request) {
  const match = request.headers.get('cookie')?.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match?.[1] === 'canary' || match?.[1] === 'stable' ? match[1] : null;
}

function pickRelease(request, env) {
  if (env.CANARY_ENABLED !== 'true') return 'stable';
  const pinned = releaseFromCookie(request);
  if (pinned) return pinned;
  return Math.random() * 100 < percentage(env) ? 'canary' : 'stable';
}

async function fetchWithFailover(request, env, release) {
  const primary = originUrl(request, env, release);
  const headers = new Headers(request.headers);
  headers.set('x-release-channel', release);
  const init = { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body, redirect: 'manual' };
  try {
    const response = await fetch(primary, init);
    if (response.status >= 500 && release === 'canary' && env.STABLE_ORIGIN) {
      const fallback = await fetch(originUrl(request, env, 'stable'), init);
      if (fallback.ok || fallback.status < 500) return fallback;
    }
    return response;
  } catch (error) {
    if (release === 'canary' && env.STABLE_ORIGIN) return fetch(originUrl(request, env, 'stable'), init);
    throw error;
  }
}

export default {
  async fetch(request, env) {
    if (blockedRegion(request, env)) return new Response('Blocked by regional policy', { status: 403 });
    const quota = rateLimit(request, env);
    if (!quota.allowed) {
      const headers = { 'Retry-After': '60', 'X-RateLimit-Limit': String(quota.limit), 'X-RateLimit-Remaining': '0' };
      if (env.TURNSTILE_SITE_KEY && request.method !== 'OPTIONS') headers['X-Captcha-Required'] = 'turnstile';
      return new Response(JSON.stringify({ error: 'edge_rate_limit_exceeded', captchaRequired: Boolean(env.TURNSTILE_SITE_KEY) }), { status: 429, headers: { ...headers, 'content-type': 'application/json' } });
    }
    const release = pickRelease(request, env);
    const response = await fetchWithFailover(request, env, release);
    const headers = new Headers(response.headers);
    if (!releaseFromCookie(request) && env.CANARY_ENABLED === 'true') {
      headers.append('set-cookie', `${COOKIE_NAME}=${release}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax`);
    }
    headers.set('x-release-channel', release);
    headers.set('x-origin-protection', 'cloudflare-rate-limit');
    headers.set('x-rate-limit-remaining', String(Math.max(0, quota.limit - quota.count)));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
