/**
 * Advanced rate limiting by IP, by user, per endpoint, with burst allowance,
 * premium bypass, structured violation logging and a metrics snapshot (#941).
 *
 * Why another limiter next to `src/rate-limiter.js`: that one answers "how many
 * requests may this key make", this one answers "who is asking and how much
 * slack do they get" — the per-IP budget is deliberately the strict one (an
 * anonymous address can be anyone), the per-user budget is the lenient one (a
 * signed-in user is accountable), endpoints may tighten either of them, and
 * authenticated callers get a burst allowance on top of their steady budget.
 *
 * The module has no dependencies beyond the Node runtime, so it can be used
 * from the HTTP server, from tests and from tooling without wiring a framework.
 */

/** Steady budget plus the burst allowance an authenticated caller may dip into. */
export const TIERS = {
  anonymous: { limit: 60, windowMs: 60_000, burst: 0 },
  authenticated: { limit: 300, windowMs: 60_000, burst: 30 },
  premium: { limit: 1200, windowMs: 60_000, burst: 120, bypass: true },
};

/**
 * Endpoint overrides, matched by `${METHOD} ${path-prefix}`. The longest
 * matching prefix wins, so `/graphql` does not shadow `/graphql/stream`.
 */
export const PER_IP_ENDPOINT_RULES = {
  'GET /health': { perIp: { limit: 600, windowMs: 60_000, burst: 0 } },
  'POST /graphql': { perIp: { limit: 30, windowMs: 60_000, burst: 0 }, perUser: { limit: 120, windowMs: 60_000, burst: 20 } },
  'POST /credentials': { perIp: { limit: 20, windowMs: 60_000, burst: 0 }, perUser: { limit: 60, windowMs: 60_000, burst: 10 } },
  'GET /metrics': { bypass: true },
};

/** How many recent violations are kept for the dashboard. */
export const VIOLATION_BUFFER = 100;

/**
 * The rule pattern an endpoint falls under, or `undefined` when no rule matches.
 *
 * Buckets are keyed by this rather than by the raw path: two paths matched by
 * one rule (`/credentials` and `/credentials/issue`) share a budget, which is
 * what the rule means.
 */
export function matchPerIpEndpointKey(endpoint, rules = PER_IP_ENDPOINT_RULES) {
  const matched = matchPerIpEndpointRule(endpoint, rules);
  if (!matched) return undefined;
  const space = endpoint.indexOf(' ');
  const method = space === -1 ? '*' : endpoint.slice(0, space).toUpperCase();
  const path = space === -1 ? endpoint : endpoint.slice(space + 1);
  let bestKey;
  let bestLength = -1;
  for (const [pattern, rule] of Object.entries(rules)) {
    if (rule !== matched) continue;
    const patternSpace = pattern.indexOf(' ');
    const ruleMethod = patternSpace === -1 ? '*' : pattern.slice(0, patternSpace).toUpperCase();
    const prefix = patternSpace === -1 ? pattern : pattern.slice(patternSpace + 1);
    if (ruleMethod !== '*' && ruleMethod !== method) continue;
    if (path !== prefix && !path.startsWith(prefix)) continue;
    if (prefix.length > bestLength) {
      bestKey = pattern;
      bestLength = prefix.length;
    }
  }
  return bestKey;
}

export function matchPerIpEndpointRule(endpoint, rules = PER_IP_ENDPOINT_RULES) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return undefined;
  const space = endpoint.indexOf(' ');
  const method = space === -1 ? '*' : endpoint.slice(0, space).toUpperCase();
  const path = space === -1 ? endpoint : endpoint.slice(space + 1);

  let best;
  let bestLength = -1;
  for (const [pattern, rule] of Object.entries(rules)) {
    const patternSpace = pattern.indexOf(' ');
    const ruleMethod = patternSpace === -1 ? '*' : pattern.slice(0, patternSpace).toUpperCase();
    const prefix = patternSpace === -1 ? pattern : pattern.slice(patternSpace + 1);
    if (ruleMethod !== '*' && ruleMethod !== method) continue;
    if (path !== prefix && !path.startsWith(prefix)) continue;
    // The longest matching prefix wins, so `/graphql` cannot shadow
    // `/graphql/stream`.
    if (prefix.length > bestLength) {
      best = rule;
      bestLength = prefix.length;
    }
  }
  return best;
}

/**
 * Adapter for the rules the older `src/rate-limiter.js` exports (an array of
 * `{ method, pattern: RegExp, windowMs, limit }`): the per-IP budget keeps the
 * configured limit, the per-user budget gets double the window budget, because
 * a signed-in caller is accountable and one address can be shared.
 */
/** `/^\/credentials(\/issue)?$/` → `/credentials` — the prefix this module matches on. */
export function literalPrefix(pattern) {
  const source = pattern.source.replace(/^\^/, '');
  let literal = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      // `\/` is an escaped slash, anything else starts a character class or a
      // shorthand and is where the literal prefix ends.
      if (source[index + 1] === '/') {
        literal += '/';
        index += 1;
        continue;
      }
      break;
    }
    if ('^$.*+?()[]{}|'.includes(char)) break;
    literal += char;
  }
  return literal === '' ? '/' : literal;
}

export function fromTieredRules(rules, { userMultiplier = 2 } = {}) {
  const converted = {};
  for (const rule of rules) {
    const method = (rule.method ?? '*').toUpperCase();
    const prefix = literalPrefix(rule.pattern);
    const name = `${method} ${prefix}`;
    converted[name] = {
      perIp: { limit: rule.limit, windowMs: rule.windowMs, burst: 0 },
      perUser: {
        limit: Math.max(rule.limit, Math.round(rule.limit * userMultiplier)),
        windowMs: rule.windowMs,
        burst: 0,
      },
    };
  }
  return converted;
}

export class AdvancedRateLimiter {
  #now;
  #tiers;
  #endpoints;
  #logger;
  #violationBuffer;
  #buckets = new Map();
  #violations = [];
  #totals = { allowed: 0, blocked: 0, bypassed: 0 };
  #byStrategy = { ip: 0, user: 0, endpoint: 0 };
  #byEndpoint = new Map();
  #offenders = new Map();

  constructor(options = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#tiers = { ...TIERS, ...(options.tiers ?? {}) };
    this.#endpoints = options.endpoints ?? PER_IP_ENDPOINT_RULES;
    this.#logger = options.logger ?? console;
    this.#violationBuffer = options.violationBuffer ?? VIOLATION_BUFFER;
  }

  /**
   * @param {object} request
   * @param {string} [request.ip]        Remote address (required for per-IP limits).
   * @param {string} [request.userId]    Account id when the caller is signed in.
   * @param {string} [request.endpoint]  `${METHOD} ${path}` — used for endpoint rules.
   * @param {boolean} [request.premium]  Premium account: limits are bypassed, not ignored.
   * @returns {{allowed: boolean, status: number, strategy: string|null, limit: number,
   *            remaining: number, resetAt: number, retryAfterMs: number, headers: object}}
   */
  check(request = {}) {
    const now = this.#now();
    const { ip, userId, endpoint, premium = false } = request;
    const authenticated = Boolean(userId);
    const tierName = premium ? 'premium' : authenticated ? 'authenticated' : 'anonymous';
    const tier = this.#tiers[tierName];
    const endpointRule = matchPerIpEndpointRule(endpoint, this.#endpoints);
    // Two paths under one rule share a budget (see matchPerIpEndpointKey).
    const endpointKey = matchPerIpEndpointKey(endpoint, this.#endpoints) ?? endpoint ?? '*';

    if (premium && (tier.bypass || endpointRule?.bypass)) {
      this.#totals.bypassed += 1;
      this.#countEndpoint(endpoint, 'bypassed');
      return this.#result({
        allowed: true,
        strategy: 'premium-bypass',
        limit: Number.POSITIVE_INFINITY,
        remaining: Number.POSITIVE_INFINITY,
        resetAt: now + tier.windowMs,
        retryAfterMs: 0,
        headers: {},
      });
    }
    if (endpointRule?.bypass) {
      this.#totals.bypassed += 1;
      this.#countEndpoint(endpoint, 'bypassed');
      return this.#result({
        allowed: true,
        strategy: 'endpoint-bypass',
        limit: Number.POSITIVE_INFINITY,
        remaining: Number.POSITIVE_INFINITY,
        resetAt: now + tier.windowMs,
        retryAfterMs: 0,
        headers: {},
      });
    }

    // The per-IP budget is checked first on purpose: it is the strict one, and a
    // blocked IP must not be able to spend a user budget it shares with others.
    const checks = [];
    if (ip) {
      checks.push({
        strategy: 'ip',
        key: `ip:${ip}:${endpointKey}`,
        // The burst allowance is for authenticated *users*: an address can be
        // shared by anyone, so it only ever gets the steady budget.
        rule: { ...tier, burst: 0, ...(endpointRule?.perIp ?? {}) },
      });
    }
    if (userId) {
      checks.push({
        strategy: 'user',
        key: `user:${userId}:${endpointKey}`,
        rule: { ...tier, ...(endpointRule?.perUser ?? {}) },
      });
    }
    if (checks.length === 0) {
      checks.push({ strategy: 'ip', key: 'ip:unknown', rule: tier });
    }

    let strictest = null;
    for (const check of checks) {
      const outcome = this.#consume(check.key, check.rule, now, authenticated);
      // Which budget was consulted — the metric and the violation log both key on it.
      outcome.strategy = check.strategy;
      if (!outcome.allowed) return this.#reject(outcome, request, endpoint, now);
      if (!strictest || outcome.remaining < strictest.remaining) strictest = outcome;
    }

    this.#totals.allowed += 1;
    this.#countEndpoint(endpoint, 'allowed');
    return this.#result({
      allowed: true,
      strategy: strictest.strategy,
      limit: strictest.limit,
      remaining: strictest.remaining,
      resetAt: strictest.resetAt,
      retryAfterMs: 0,
      headers: this.#headers(strictest),
    });
  }

  /** Structured violation log + counters, ready for a dashboard or an alert. */
  metrics() {
    const topOffenders = [...this.#offenders.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totals: { ...this.#totals },
      byStrategy: { ...this.#byStrategy },
      byEndpoint: Object.fromEntries(this.#byEndpoint),
      violations: this.#violations.map((violation) => ({ ...violation })),
      topOffenders,
      windowMs: Object.fromEntries(
        Object.entries(this.#tiers).map(([name, tier]) => [name, tier.windowMs])
      ),
    };
  }

  /** Prometheus text exposition — one scrape line per series, no dependency. */
  toPrometheus() {
    const metrics = this.metrics();
    const lines = [
      '# HELP soroban_ratelimit_decisions_total Rate limit decisions by outcome.',
      '# TYPE soroban_ratelimit_decisions_total counter',
      `soroban_ratelimit_decisions_total{outcome="allowed"} ${metrics.totals.allowed}`,
      `soroban_ratelimit_decisions_total{outcome="blocked"} ${metrics.totals.blocked}`,
      `soroban_ratelimit_decisions_total{outcome="bypassed"} ${metrics.totals.bypassed}`,
      '# HELP soroban_ratelimit_violations_total Violations by strategy.',
      '# TYPE soroban_ratelimit_violations_total counter',
    ];
    for (const [strategy, count] of Object.entries(metrics.byStrategy)) {
      lines.push(`soroban_ratelimit_violations_total{strategy="${strategy}"} ${count}`);
    }
    return lines.join('\n') + '\n';
  }

  /** Drop every bucket and counter — used by tests and by config reloads. */
  reset() {
    this.#buckets.clear();
    this.#violations = [];
    this.#totals = { allowed: 0, blocked: 0, bypassed: 0 };
    this.#byStrategy = { ip: 0, user: 0, endpoint: 0 };
    this.#byEndpoint.clear();
    this.#offenders.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  #consume(key, rule, now, authenticated) {
    const windowMs = rule.windowMs ?? 60_000;
    const limit = rule.limit ?? 60;
    const burst = authenticated ? (rule.burst ?? 0) : 0;
    const capacity = limit + burst;

    let bucket = this.#buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;

    const allowed = bucket.count <= capacity;
    return {
      allowed,
      limit: capacity,
      remaining: Math.max(0, capacity - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, bucket.resetAt - now),
    };
  }

  #reject(outcome, request, endpoint, now) {
    const violation = {
      at: new Date(now).toISOString(),
      strategy: outcome.strategy,
      limit: outcome.limit,
      ip: request.ip ?? null,
      userId: request.userId ?? null,
      endpoint: endpoint ?? null,
      retryAfterMs: outcome.retryAfterMs,
    };

    this.#totals.blocked += 1;
    if (outcome.strategy in this.#byStrategy) this.#byStrategy[outcome.strategy] += 1;
    this.#countEndpoint(endpoint, 'blocked');
    this.#violations.push(violation);
    if (this.#violations.length > this.#violationBuffer) this.#violations.shift();
    const offenderKey = request.userId ? `user:${request.userId}` : `ip:${request.ip ?? 'unknown'}`;
    this.#offenders.set(offenderKey, (this.#offenders.get(offenderKey) ?? 0) + 1);

    // One structured line per violation: enough to alert on, cheap enough to
    // keep at 100% sampling.
    this.#logger?.warn?.({ event: 'rate_limit_violation', ...violation });

    return this.#result({
      allowed: false,
      strategy: outcome.strategy,
      limit: outcome.limit,
      remaining: 0,
      resetAt: outcome.resetAt,
      retryAfterMs: outcome.retryAfterMs,
      headers: {
        ...this.#headers(outcome),
        'retry-after': String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))),
      },
    });
  }

  #countEndpoint(endpoint, outcome) {
    const key = endpoint ?? '*';
    const current = this.#byEndpoint.get(key) ?? { allowed: 0, blocked: 0, bypassed: 0 };
    current[outcome] += 1;
    this.#byEndpoint.set(key, current);
  }

  #headers(outcome) {
    return {
      'x-ratelimit-limit': Number.isFinite(outcome.limit) ? String(outcome.limit) : 'unlimited',
      'x-ratelimit-remaining': Number.isFinite(outcome.remaining)
        ? String(outcome.remaining)
        : 'unlimited',
      'x-ratelimit-reset': String(Math.ceil(outcome.resetAt / 1000)),
    };
  }

  #result(outcome) {
    return {
      allowed: outcome.allowed,
      status: outcome.allowed ? 200 : 429,
      strategy: outcome.strategy,
      limit: outcome.limit,
      remaining: outcome.remaining,
      resetAt: outcome.resetAt,
      retryAfterMs: outcome.retryAfterMs,
      headers: outcome.headers,
    };
  }
}

export default AdvancedRateLimiter;
