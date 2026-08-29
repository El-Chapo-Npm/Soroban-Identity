import test from 'node:test';
import assert from 'node:assert/strict';
import { DdosProtection } from '../src/ddos-protection.js';
import { QueryResultCache } from '../src/query-cache.js';

test('DDoS policy limits IPs and caps concurrent connections', async () => {
  let now = 1_000;
  const policy = new DdosProtection({ ddosProtectionEnabled: true, ddosMaxRequestsPerIp: 2, ddosMaxConnectionsPerIp: 1, ddosSuspiciousThreshold: 2 }, { now: () => now });
  const req = { headers: {}, socket: { remoteAddress: '203.0.113.10' } };
  assert.equal((await policy.check(req)).allowed, true);
  assert.equal((await policy.check(req)).allowed, true);
  assert.equal((await policy.check(req)).reason, 'ip_rate_limited');
  assert.equal(policy.connectionOpened('203.0.113.10'), true);
  assert.equal(policy.connectionOpened('203.0.113.10'), false);
  policy.connectionClosed('203.0.113.10');
  now += 61_000;
  assert.equal((await policy.check(req)).allowed, true);
});

test('DDoS policy blocks configured regions and requires CAPTCHA for suspicious requests', async () => {
  const policy = new DdosProtection({ ddosProtectionEnabled: true, ddosMaxRequestsPerIp: 10, ddosSuspiciousThreshold: 1, ddosCaptchaEnabled: true, ddosCaptchaSecret: 'secret', ddosBlockedRegions: ['KP'] }, { verifyCaptcha: async () => false });
  assert.equal((await policy.check({ headers: { 'cf-ipcountry': 'KP' }, socket: { remoteAddress: '1.1.1.1' } })).reason, 'geo_blocked');
  assert.equal((await policy.check({ headers: { }, socket: { remoteAddress: '2.2.2.2' } })).reason, 'captcha_required');
});

test('query cache uses Redis and invalidates stale results', async () => {
  const values = new Map();
  const redis = { async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async del(key) { values.delete(key); } };
  const outcomes = [];
  const cache = new QueryResultCache({ queryCacheEnabled: true, queryCacheDefaultTtlMs: 1000 }, { redisClient: redis, metrics: { observeQueryCache: (outcome) => outcomes.push(outcome) } });
  await cache.set('hot_query', [], { count: 3 }, 'stable');
  assert.deepEqual(await cache.get('hot_query'), { count: 3 });
  await cache.invalidate('hot_query');
  assert.equal(await cache.get('hot_query'), null);
  assert.deepEqual(outcomes, ['hit', 'miss']);
});
