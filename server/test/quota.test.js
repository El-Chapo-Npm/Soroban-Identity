import assert from 'node:assert/strict';
import test from 'node:test';
import { pickQuotaBinding, QuotaTracker, QUOTA_TIERS } from '../src/quota.js';

function makeReq({ apiKeyId = 'k1', tier = 'free', ip = '1.2.3.4' } = {}) {
  return {
    apiKeyId,
    userTier: tier,
    headers: {},
    socket: { remoteAddress: ip },
  };
}

test('resolveTier falls back to free for an unknown/absent tier', () => {
  const tracker = new QuotaTracker();
  assert.equal(tracker.resolveTier({ headers: {} }), 'free');
  assert.equal(tracker.resolveTier({ userTier: 'bogus', headers: {} }), 'free');
});

test('consume increments both daily and monthly counters together', () => {
  const tracker = new QuotaTracker({ now: () => Date.parse('2026-06-15T00:00:00Z') });
  const req = makeReq();
  const first = tracker.consume(req);
  assert.equal(first.allowed, true);
  assert.equal(first.daily.used, 1);
  assert.equal(first.monthly.used, 1);
  const second = tracker.consume(req);
  assert.equal(second.daily.used, 2);
  assert.equal(second.monthly.used, 2);
});

test('overageMode "block" rejects once the daily limit is reached', () => {
  const tiers = { free: { name: 'free', dailyLimit: 2, monthlyLimit: 1000 } };
  const tracker = new QuotaTracker({ tiers, overageMode: 'block', now: () => Date.now() });
  const req = makeReq();
  assert.equal(tracker.consume(req).allowed, true);
  assert.equal(tracker.consume(req).allowed, true);
  const third = tracker.consume(req);
  assert.equal(third.allowed, false);
  assert.equal(third.overage, true);
  assert.equal(third.scope, 'daily');
  // A blocked request must not itself consume quota.
  assert.equal(third.daily.used, 2);
});

test('overageMode "allow" lets an over-quota request through, flagged', () => {
  const tiers = { free: { name: 'free', dailyLimit: 1, monthlyLimit: 1000 } };
  const tracker = new QuotaTracker({ tiers, overageMode: 'allow' });
  const req = makeReq();
  tracker.consume(req);
  const second = tracker.consume(req);
  assert.equal(second.allowed, true);
  assert.equal(second.overage, true);
  assert.equal(second.daily.used, 2);
});

test('daily counter resets at the next UTC day boundary, monthly counter does not', () => {
  const tiers = { free: { name: 'free', dailyLimit: 10, monthlyLimit: 1000 } };
  let now = Date.parse('2026-06-15T23:59:00Z');
  const tracker = new QuotaTracker({ tiers, now: () => now });
  const req = makeReq();
  tracker.consume(req);
  tracker.consume(req);
  let usage = tracker.peek(req);
  assert.equal(usage.daily.used, 2);
  assert.equal(usage.monthly.used, 2);

  now = Date.parse('2026-06-16T00:00:01Z');
  usage = tracker.peek(req);
  assert.equal(usage.daily.used, 0, 'daily count rolls over past UTC midnight');
  assert.equal(usage.monthly.used, 2, 'monthly count survives a daily rollover');
});

test('monthly counter resets on the 1st of the next UTC month', () => {
  const tiers = { free: { name: 'free', dailyLimit: 1000, monthlyLimit: 1000 } };
  let now = Date.parse('2026-06-30T23:59:00Z');
  const tracker = new QuotaTracker({ tiers, now: () => now });
  const req = makeReq();
  tracker.consume(req);

  now = Date.parse('2026-07-01T00:00:01Z');
  const usage = tracker.peek(req);
  assert.equal(usage.monthly.used, 0);
});

test('onThreshold fires exactly once per period per threshold at 80% and 100%', () => {
  const tiers = { free: { name: 'free', dailyLimit: 5, monthlyLimit: 1000 } };
  const events = [];
  const tracker = new QuotaTracker({
    tiers,
    overageMode: 'allow',
    onThreshold: (info) => events.push(info),
  });
  const req = makeReq();
  for (let i = 0; i < 6; i += 1) tracker.consume(req);

  const dailyEvents = events.filter((e) => e.period === 'daily');
  assert.equal(dailyEvents.length, 2, 'exactly one 80% and one 100% event, no duplicates');
  assert.deepEqual(dailyEvents.map((e) => e.threshold).sort(), [0.8, 1]);
  assert.equal(dailyEvents[0].apiKeyId, 'k1');
});

test('distinct API keys get independent buckets', () => {
  const tiers = { free: { name: 'free', dailyLimit: 1, monthlyLimit: 1000 } };
  const tracker = new QuotaTracker({ tiers, overageMode: 'block' });
  const a = tracker.consume(makeReq({ apiKeyId: 'a' }));
  const b = tracker.consume(makeReq({ apiKeyId: 'b' }));
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
});

test('pickQuotaBinding reports whichever period is proportionally closest to exhaustion', () => {
  const usage = {
    daily: { limit: 100, used: 90, remaining: 10, resetAt: 1 },
    monthly: { limit: 1000, used: 100, remaining: 900, resetAt: 2 },
  };
  assert.equal(pickQuotaBinding(usage).period, 'daily');

  const usage2 = {
    daily: { limit: 100, used: 10, remaining: 90, resetAt: 1 },
    monthly: { limit: 1000, used: 950, remaining: 50, resetAt: 2 },
  };
  assert.equal(pickQuotaBinding(usage2).period, 'monthly');
});

test('default tiers exist for free, pro and enterprise', () => {
  assert.ok(QUOTA_TIERS.free.dailyLimit > 0);
  assert.ok(QUOTA_TIERS.pro.dailyLimit > QUOTA_TIERS.free.dailyLimit);
  assert.ok(QUOTA_TIERS.enterprise.dailyLimit > QUOTA_TIERS.pro.dailyLimit);
});
