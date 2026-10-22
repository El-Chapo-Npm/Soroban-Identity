import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageBroker, PRIORITY, backoffDelay } from '../src/messaging/index.js';
import { TimeSeriesStore, METRICS } from '../src/timeseries/index.js';
import { IsolationForest, FraudDetector } from '../src/fraud/index.js';
import {
  ServiceRegistry, signServiceToken, verifyServiceToken, traceHeaders, parseTraceparent,
  matchRoute, createGateway, createService, SERVICES,
} from '../src/microservices/index.js';

// #1113 message queue
test('broker delivers by priority and dedups', async () => {
  const b = new MessageBroker();
  const seen = [];
  b.publish('q', { n: 1 }, { priority: PRIORITY.LOW });
  b.publish('q', { n: 2 }, { priority: PRIORITY.URGENT });
  assert.equal(b.publish('q', { n: 2 }), null);
  b.consume('q', async (p) => { seen.push(p.n); });
  await b.drain();
  assert.deepEqual(seen, [2, 1]);
  assert.equal(b.stats().q.duplicates, 1);
  b.close();
});

test('broker retries with backoff then dead-letters', async () => {
  const b = new MessageBroker({ maxRetries: 2, backoff: { baseMs: 1, maxMs: 2 } });
  let calls = 0;
  const dead = new Promise((r) => b.on('dead-letter', r));
  b.publish('q', { x: 1 });
  b.consume('q', async () => { calls++; throw new Error('boom'); });
  await dead;
  assert.equal(calls, 3);
  assert.equal(b.stats()['q.dlq'].depth, 1);
  assert.equal(b.redriveDeadLetters('q'), 1);
  b.close();
});

test('broker preserves ordering per key under concurrency', async () => {
  const b = new MessageBroker();
  const seen = [];
  for (let i = 0; i < 5; i++) b.publish('q', { i }, { orderingKey: 'k', dedupKey: `m${i}` });
  b.consume('q', async (p) => { await new Promise((r) => setTimeout(r, 5 - p.i)); seen.push(p.i); }, { concurrency: 4 });
  await b.drain();
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  b.close();
});

test('broker persists unacked messages across restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-'));
  const a = new MessageBroker({ persistDir: dir });
  a.publish('q', { keep: true });
  a.close();
  const b = new MessageBroker({ persistDir: dir });
  assert.equal(b.stats().q.depth, 1);
  b.close();
});

test('backoff grows exponentially and is capped', () => {
  assert.ok(backoffDelay(1, { jitter: 0 }) < backoffDelay(4, { jitter: 0 }));
  assert.equal(backoffDelay(50, { maxMs: 1000, jitter: 0 }), 1000);
});

// #1112 time series
test('time-series aggregation, retention and downsampling', () => {
  const s = new TimeSeriesStore({ rawRetentionMs: 1000, rollupRetentionMs: 10_000, rollupBucketMs: 100 });
  for (let i = 0; i < 10; i++) s.write(METRICS.API_LATENCY, i, { route: '/a' }, i * 10);
  const before = s.query(METRICS.API_LATENCY, { from: 0, to: 1000, bucketMs: 1000 });
  assert.equal(before[0].count, 10);
  assert.equal(before[0].max, 9);
  const r = s.compact(2000);
  assert.equal(r.downsampled, 10);
  const after = s.query(METRICS.API_LATENCY, { from: 0, to: 1000, bucketMs: 1000 });
  assert.equal(after[0].count, 10);
  assert.equal(after[0].avg, 4.5);
  assert.equal(s.compact(20_000).dropped, 1);
});

// #1111 fraud
test('isolation forest scores outliers higher', () => {
  const data = Array.from({ length: 300 }, (_, i) => [i % 5, (i * 7) % 5]);
  const f = new IsolationForest({ trees: 50 }).fit(data);
  assert.ok(f.score([500, 500]) > f.score([2, 2]));
});

test('fraud detector blocks bursts, queues reviews, tracks feedback', () => {
  const d = new FraudDetector();
  const t0 = Date.now();
  let last;
  for (let i = 0; i < 105; i++) last = d.evaluate({ actor: 'a', type: 'issue', subject: `s${i}`, ts: t0 + i });
  assert.equal(last.decision, 'block');
  d.evaluate({ actor: 'b', type: 'verify', geo: { lat: 0, lon: 0 }, ts: t0 });
  const travel = d.evaluate({ actor: 'b', type: 'verify', geo: { lat: 50, lon: 50 }, ts: t0 + 60_000 });
  assert.equal(travel.decision, 'review');
  assert.equal(d.listReviews().length, 1);
  d.resolveReview(travel.id, 'legitimate');
  const rep = d.report();
  assert.equal(rep.feedback.falsePositives, 1);
  assert.ok(rep.blocked >= 1);
});

// #1110 microservices
test('service tokens verify and reject tampering', () => {
  const tok = signServiceToken({ issuer: 'a', audience: 'b' }, 's3cret');
  assert.equal(verifyServiceToken(tok, { audience: 'b', secret: 's3cret' }).iss, 'a');
  assert.throws(() => verifyServiceToken(tok, { audience: 'b', secret: 'other' }));
  assert.throws(() => verifyServiceToken(tok, { audience: 'c', secret: 's3cret' }));
});

test('trace headers propagate trace id', () => {
  const a = traceHeaders();
  const b = traceHeaders(a.traceparent);
  assert.equal(parseTraceparent(b.traceparent).traceId, a.traceId);
  assert.notEqual(b.spanId, a.spanId);
});

test('registry round-robins healthy instances', () => {
  const r = new ServiceRegistry({ ttlMs: 1000 });
  r.register('x', { host: 'h1', port: 1 });
  r.register('x', { host: 'h2', port: 2 });
  assert.notEqual(r.resolve('x').host, r.resolve('x').host);
  assert.equal(matchRoute('/credentials/123').service, SERVICES.CREDENTIAL);
  assert.equal(matchRoute('/nope'), null);
});

test('gateway routes to authenticated service end to end', async () => {
  const secret = 'k';
  const svc = createService({ name: SERVICES.REPUTATION, secret, handler: (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ caller: req.caller.iss, path: req.url }));
  } });
  await new Promise((r) => svc.listen(0, r));
  const registry = new ServiceRegistry();
  registry.register(SERVICES.REPUTATION, { host: '127.0.0.1', port: svc.address().port });
  const gw = createGateway({ registry, secret });
  await new Promise((r) => gw.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${gw.address().port}/reputation/abc`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { caller: 'api-gateway', path: '/reputation/abc' });
  assert.ok(res.headers.get('x-trace-id'));
  const direct = await fetch(`http://127.0.0.1:${svc.address().port}/x`);
  assert.equal(direct.status, 401);
  gw.close(); svc.close();
});

test('service breaker opens after threshold', async () => {
  const { ServiceBreaker, CircuitOpenError } = await import('../src/microservices/index.js');
  const br = new ServiceBreaker('x', { failureThreshold: 2, openMs: 10_000 });
  for (let i = 0; i < 2; i++) await assert.rejects(br.call(async () => { throw new Error('e'); }));
  await assert.rejects(br.call(async () => 1), CircuitOpenError);
});
