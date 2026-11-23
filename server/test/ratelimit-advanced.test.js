import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdvancedRateLimiter,
  PER_IP_ENDPOINT_RULES,
  TIERS,
  fromTieredRules,
  literalPrefix,
  matchPerIpEndpointRule,
} from '../src/middleware/ratelimit-advanced.js';

/** Controllable clock so window expiry is deterministic. */
function makeLimiter(options = {}) {
  let now = 1_000_000;
  const limiter = new AdvancedRateLimiter({ now: () => now, ...options });
  return {
    limiter,
    advance(ms) {
      now += ms;
    },
  };
}

function request(overrides = {}) {
  return { ip: '10.0.0.1', endpoint: 'GET /credentials', ...overrides };
}

test('the per-IP budget is the strict one: many addresses cannot share a user budget', () => {
  const { limiter } = makeLimiter({
    endpoints: {
      'POST /credentials': {
        perIp: { limit: 2, windowMs: 60_000, burst: 0 },
        perUser: { limit: 10, windowMs: 60_000, burst: 5 },
      },
    },
  });

  const first = limiter.check(request({ ip: '1.1.1.1', userId: 'user-1', endpoint: 'POST /credentials' }));
  const second = limiter.check(request({ ip: '1.1.1.1', userId: 'user-1', endpoint: 'POST /credentials' }));
  const third = limiter.check(request({ ip: '1.1.1.1', userId: 'user-1', endpoint: 'POST /credentials' }));

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.status, 429);
  assert.equal(third.strategy, 'ip', 'the IP budget must be the one that blocks');
  assert.ok(third.retryAfterMs > 0);
  assert.equal(third.headers['retry-after'], '60');

  // The same user from another address still has their own budget.
  const fromElsewhere = limiter.check(
    request({ ip: '2.2.2.2', userId: 'user-1', endpoint: 'POST /credentials' })
  );
  assert.equal(fromElsewhere.allowed, true);
});

test('the per-IP budget is exhausted first, the user budget keeps its burst', () => {
  const { limiter } = makeLimiter();
  const ip = '3.3.3.3';
  const otherIp = '3.3.3.4';
  const userId = 'user-2';
  const ipCapacity = TIERS.authenticated.limit;
  const userCapacity = TIERS.authenticated.limit + TIERS.authenticated.burst;

  let blockedByIp;
  for (let index = 0; index < ipCapacity + 1; index += 1) {
    const outcome = limiter.check(request({ ip, userId, endpoint: 'GET /credentials' }));
    if (!outcome.allowed) blockedByIp = outcome;
  }

  assert.ok(blockedByIp, 'the per-IP budget must run out');
  assert.equal(blockedByIp.strategy, 'ip');
  assert.equal(blockedByIp.limit, ipCapacity, 'the IP budget does not include the burst');
  assert.equal(blockedByIp.headers['retry-after'], '60');

  // The same account from another address still has its own, larger budget: the
  // request that the IP could not make is allowed for the authenticated user.
  const fromElsewhere = limiter.check(request({ ip: otherIp, userId, endpoint: 'GET /credentials' }));
  assert.equal(fromElsewhere.allowed, true);
  assert.equal(fromElsewhere.limit, userCapacity);

  // And the user budget does end — one burst later than the IP budget does.
  let blockedByUser;
  for (let index = 0; index < userCapacity; index += 1) {
    const outcome = limiter.check(request({ ip: otherIp, userId, endpoint: 'GET /credentials' }));
    if (!outcome.allowed) {
      blockedByUser = outcome;
      break;
    }
  }
  assert.ok(blockedByUser, 'the per-user budget must run out too');
  assert.equal(blockedByUser.strategy, 'user');
  assert.equal(blockedByUser.limit, userCapacity);
});

test('anonymous callers get the strict budget and no burst', () => {
  const { limiter } = makeLimiter();
  const capacity = TIERS.anonymous.limit + TIERS.anonymous.burst;

  const outcomes = Array.from({ length: capacity + 1 }, () =>
    limiter.check(request({ ip: '4.4.4.4', endpoint: 'GET /credentials' }))
  );

  assert.equal(outcomes.filter((outcome) => outcome.allowed).length, capacity);
  assert.equal(outcomes[capacity].allowed, false);
  assert.equal(outcomes[capacity].limit, capacity);
});

test('endpoint rules tighten a single route without touching the others', () => {
  const { limiter } = makeLimiter({ endpoints: PER_IP_ENDPOINT_RULES });
  const ip = '5.5.5.5';

  const graphql = Array.from({ length: 31 }, () =>
    limiter.check(request({ ip, userId: 'user-3', endpoint: 'POST /graphql' }))
  );
  assert.equal(graphql[29].allowed, true);
  assert.equal(graphql[30].allowed, false);
  assert.equal(graphql[30].strategy, 'ip');

  // A different route from the same address is unaffected.
  assert.equal(limiter.check(request({ ip, userId: 'user-3', endpoint: 'GET /health' })).allowed, true);
});

test('premium accounts bypass the limits but are still counted', () => {
  const { limiter } = makeLimiter();

  for (let index = 0; index < 500; index += 1) {
    const outcome = limiter.check(request({ ip: '6.6.6.6', userId: 'vip', premium: true }));
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.status, 200);
  }

  const metrics = limiter.metrics();
  assert.equal(metrics.totals.bypassed, 500);
  assert.equal(metrics.totals.blocked, 0);
});

test('violations are logged once, with the fields an alert needs', () => {
  const logged = [];
  const { limiter } = makeLimiter({
    logger: { warn: (entry) => logged.push(entry) },
    endpoints: { 'POST /graphql': { perIp: { limit: 1, windowMs: 30_000, burst: 0 } } },
  });

  limiter.check(request({ ip: '7.7.7.7', endpoint: 'POST /graphql' }));
  limiter.check(request({ ip: '7.7.7.7', endpoint: 'POST /graphql' }));

  assert.equal(logged.length, 1);
  assert.equal(logged[0].event, 'rate_limit_violation');
  assert.equal(logged[0].strategy, 'ip');
  assert.equal(logged[0].ip, '7.7.7.7');
  assert.equal(logged[0].endpoint, 'POST /graphql');
  assert.equal(logged[0].retryAfterMs, 30_000);
  assert.match(logged[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('metrics describe who was blocked, where, and by which budget', () => {
  const { limiter } = makeLimiter({
    endpoints: { 'POST /graphql': { perIp: { limit: 1, windowMs: 60_000, burst: 0 } } },
  });
  limiter.check(request({ ip: '8.8.8.8', endpoint: 'POST /graphql' }));
  limiter.check(request({ ip: '8.8.8.8', endpoint: 'POST /graphql' }));
  const allowed = limiter.check(request({ ip: '9.9.9.9', endpoint: 'GET /credentials' }));

  const metrics = limiter.metrics();
  assert.equal(allowed.allowed, true);
  assert.equal(metrics.totals.allowed, 2);
  assert.equal(metrics.totals.blocked, 1);
  assert.equal(metrics.byStrategy.ip, 1);
  assert.equal(metrics.byEndpoint['POST /graphql'].blocked, 1);
  assert.equal(metrics.byEndpoint['GET /credentials'].allowed, 1);
  assert.deepEqual(metrics.topOffenders[0], { key: 'ip:8.8.8.8', count: 1 });
  assert.equal(metrics.violations.length, 1);

  assert.match(limiter.toPrometheus(), /soroban_ratelimit_decisions_total\{outcome="blocked"\} 1/);
  limiter.reset();
  assert.equal(limiter.metrics().totals.blocked, 0);
  assert.equal(limiter.metrics().violations.length, 0);
});

test('the window expires and the caller is allowed again', () => {
  const { limiter, advance } = makeLimiter({
    endpoints: { 'POST /graphql': { perIp: { limit: 1, windowMs: 10_000, burst: 0 } } },
  });
  assert.equal(limiter.check(request({ ip: '1.2.3.4', endpoint: 'POST /graphql' })).allowed, true);
  assert.equal(limiter.check(request({ ip: '1.2.3.4', endpoint: 'POST /graphql' })).allowed, false);

  advance(10_000);
  assert.equal(limiter.check(request({ ip: '1.2.3.4', endpoint: 'POST /graphql' })).allowed, true);
});

test('endpoint matching takes the longest prefix and respects the method', () => {
  const rules = {
    'POST /graphql': { perIp: { limit: 1 } },
    'POST /graphql/stream': { perIp: { limit: 5 } },
    '* /metrics': { bypass: true },
  };

  assert.equal(matchPerIpEndpointRule('POST /graphql/stream', rules).perIp.limit, 5);
  assert.equal(matchPerIpEndpointRule('POST /graphql', rules).perIp.limit, 1);
  assert.equal(matchPerIpEndpointRule('GET /graphql', rules), undefined);
  assert.equal(matchPerIpEndpointRule('GET /metrics', rules).bypass, true);
  assert.equal(matchPerIpEndpointRule('', rules), undefined);
});

test('existing TieredRateLimiter rules convert into per-endpoint overrides', () => {
  const converted = fromTieredRules([
    { name: 'credential_issuance', method: 'POST', pattern: /^\/credentials(\/issue)?$/, windowMs: 900_000, limit: 10 },
  ]);

  assert.equal(literalPrefix(/^\/credentials(\/issue)?$/), '/credentials');
  assert.deepEqual(Object.keys(converted), ['POST /credentials']);

  const { limiter } = makeLimiter({ endpoints: converted });
  const ip = '4.3.2.1';
  const allowed = Array.from({ length: 10 }, () =>
    limiter.check(request({ ip, endpoint: 'POST /credentials/issue' }))
  );
  assert.equal(allowed.every((outcome) => outcome.allowed), true);

  const blocked = limiter.check(request({ ip, endpoint: 'POST /credentials' }));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.strategy, 'ip');
});
