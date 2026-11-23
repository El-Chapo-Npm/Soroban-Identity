import http from 'node:http';
import crypto from 'node:crypto';

/**
 * Microservices building blocks (issue #1110).
 *
 *   ServiceRegistry      — service discovery with TTL heartbeats (Consul-compatible
 *                          adapter via `ConsulRegistry`)
 *   signServiceToken /
 *   verifyServiceToken   — HMAC-signed inter-service auth tokens
 *   traceHeaders         — W3C traceparent propagation for distributed tracing
 *   ServiceClient        — service-to-service calls with discovery, auth,
 *                          tracing and a circuit breaker per target
 *   createGateway        — API gateway routing public paths to services
 *   createService        — minimal HTTP service skeleton with auth + health
 *
 * Transport encryption (mTLS) is handled by the Linkerd mesh — see
 * infra/kubernetes/mesh/.
 */

export const SERVICES = Object.freeze({
  IDENTITY: 'identity-service',
  CREDENTIAL: 'credential-service',
  REPUTATION: 'reputation-service',
  NOTIFICATION: 'notification-service',
});

export const GATEWAY_ROUTES = [
  { prefix: '/identity', service: SERVICES.IDENTITY },
  { prefix: '/did', service: SERVICES.IDENTITY },
  { prefix: '/credentials', service: SERVICES.CREDENTIAL },
  { prefix: '/verify', service: SERVICES.CREDENTIAL },
  { prefix: '/reputation', service: SERVICES.REPUTATION },
  { prefix: '/notifications', service: SERVICES.NOTIFICATION },
];

export class ServiceRegistry {
  #instances = new Map(); // name -> Map(id -> instance)
  #rr = new Map();

  constructor({ ttlMs = 30_000 } = {}) {
    this.ttlMs = ttlMs;
  }

  register(name, { host, port, id = `${name}-${host}:${port}`, meta = {} }) {
    if (!this.#instances.has(name)) this.#instances.set(name, new Map());
    this.#instances.get(name).set(id, { id, name, host, port, meta, lastHeartbeat: Date.now() });
    return id;
  }

  heartbeat(name, id) {
    const inst = this.#instances.get(name)?.get(id);
    if (!inst) return false;
    inst.lastHeartbeat = Date.now();
    return true;
  }

  deregister(name, id) {
    return this.#instances.get(name)?.delete(id) ?? false;
  }

  healthy(name, now = Date.now()) {
    return [...(this.#instances.get(name)?.values() ?? [])].filter((i) => now - i.lastHeartbeat <= this.ttlMs);
  }

  /** Round-robin across healthy instances. */
  resolve(name) {
    const list = this.healthy(name);
    if (!list.length) return null;
    const n = (this.#rr.get(name) ?? 0) % list.length;
    this.#rr.set(name, n + 1);
    return list[n];
  }

  services() {
    return Object.fromEntries([...this.#instances.keys()].map((n) => [n, this.healthy(n)]));
  }
}

/** Consul-backed registry using the agent HTTP API. */
export class ConsulRegistry {
  constructor({ baseUrl = 'http://127.0.0.1:8500', fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async register(name, { host, port, id = `${name}-${host}:${port}` }) {
    await this.fetch(`${this.baseUrl}/v1/agent/service/register`, {
      method: 'PUT',
      body: JSON.stringify({
        ID: id, Name: name, Address: host, Port: port,
        Check: { HTTP: `http://${host}:${port}/health`, Interval: '10s', DeregisterCriticalServiceAfter: '1m' },
      }),
    });
    return id;
  }

  async resolve(name) {
    const res = await this.fetch(`${this.baseUrl}/v1/health/service/${encodeURIComponent(name)}?passing=true`);
    const list = await res.json();
    if (!list.length) return null;
    const s = list[Math.floor(Math.random() * list.length)].Service;
    return { id: s.ID, name, host: s.Address, port: s.Port };
  }
}

// ── Inter-service authentication ────────────────────────────────────────────

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signServiceToken({ issuer, audience, ttlMs = 60_000, now = Date.now() }, secret) {
  const payload = b64u(JSON.stringify({ iss: issuer, aud: audience, iat: now, exp: now + ttlMs, jti: crypto.randomUUID() }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyServiceToken(token, { audience, secret, now = Date.now() }) {
  if (typeof token !== 'string' || !token.includes('.')) throw new Error('malformed service token');
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('invalid signature');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (claims.exp < now) throw new Error('service token expired');
  if (audience && claims.aud !== audience) throw new Error('wrong audience');
  return claims;
}

// ── Distributed tracing ─────────────────────────────────────────────────────

export function parseTraceparent(header) {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header ?? '');
  return m ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}

/** Child-span headers: keeps the incoming trace id, mints a new span id. */
export function traceHeaders(incoming) {
  const parent = parseTraceparent(incoming);
  const traceId = parent?.traceId ?? crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  return { traceparent: `00-${traceId}-${spanId}-${parent?.flags ?? '01'}`, traceId, spanId };
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(target) {
    super(`circuit open for ${target}`);
    this.name = 'CircuitOpenError';
  }
}

/** Per-target breaker: opens after `failureThreshold` failures, probes after `openMs`. */
export class ServiceBreaker {
  constructor(target, { failureThreshold = 5, openMs = 30_000 } = {}) {
    this.target = target;
    this.failureThreshold = failureThreshold;
    this.openMs = openMs;
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = 0;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt < this.openMs) throw new CircuitOpenError(this.target);
      this.state = 'HALF_OPEN';
    }
    try {
      const out = await fn();
      this.state = 'CLOSED';
      this.failures = 0;
      return out;
    } catch (err) {
      this.failures++;
      if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

// ── Service client ──────────────────────────────────────────────────────────

export class ServiceClient {
  #breakers = new Map();

  constructor({ name, registry, secret, request = httpRequest, breaker = {} }) {
    this.name = name;
    this.registry = registry;
    this.secret = secret;
    this.request = request;
    this.breakerOpts = breaker;
  }

  breaker(target) {
    if (!this.#breakers.has(target)) this.#breakers.set(target, new ServiceBreaker(target, this.breakerOpts));
    return this.#breakers.get(target);
  }

  async call(target, { method = 'GET', path = '/', body, traceparent } = {}) {
    return this.breaker(target).call(async () => {
      const inst = await this.registry.resolve(target);
      if (!inst) throw new Error(`no healthy instances of ${target}`);
      const headers = {
        'content-type': 'application/json',
        'x-service-token': signServiceToken({ issuer: this.name, audience: target }, this.secret),
        traceparent: traceHeaders(traceparent).traceparent,
      };
      return this.request({ host: inst.host, port: inst.port, method, path, headers, body });
    });
  }
}

export function httpRequest({ host, port, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 500) return reject(new Error(`${res.statusCode} from ${host}:${port}`));
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── API gateway ─────────────────────────────────────────────────────────────

export function matchRoute(pathname, routes = GATEWAY_ROUTES) {
  return routes
    .filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null;
}

export function createGateway({ registry, secret, routes = GATEWAY_ROUTES, client } = {}) {
  const svc = client ?? new ServiceClient({ name: 'api-gateway', registry, secret });
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://gateway');
    const send = (status, payload, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...extra });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    if (url.pathname === '/health') return send(200, { status: 'ok', services: Object.keys(registry.services?.() ?? {}) });
    const route = matchRoute(url.pathname, routes);
    if (!route) return send(404, { error: 'no route' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const trace = traceHeaders(req.headers.traceparent);
    try {
      const out = await svc.call(route.service, {
        method: req.method,
        path: url.pathname + url.search,
        body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
        traceparent: trace.traceparent,
      });
      send(out.status, out.body, { 'x-trace-id': trace.traceId });
    } catch (err) {
      const open = err instanceof CircuitOpenError;
      send(open ? 503 : 502, { error: 'upstream unavailable', service: route.service }, { 'x-trace-id': trace.traceId });
    }
  });
}

/** Minimal service skeleton enforcing inter-service auth. */
export function createService({ name, secret, handler }) {
  return http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', service: name }));
    }
    try {
      req.caller = verifyServiceToken(req.headers['x-service-token'], { audience: name, secret });
    } catch (err) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    req.trace = parseTraceparent(req.headers.traceparent);
    return handler(req, res);
  });
}
