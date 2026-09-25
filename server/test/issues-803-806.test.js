import test from 'node:test';
import assert from 'node:assert/strict';
import { negotiateEncoding } from '../src/compression.js';
import { SubscriptionHub } from '../src/graphql/subscriptions.js';
import { DeadLetterQueue, createQueueOptions, jobOptions } from '../src/queue/index.js';

test('compression negotiates Brotli/gzip and respects quality values', () => {
  assert.equal(negotiateEncoding('gzip, br'), 'br');
  assert.equal(negotiateEncoding('br;q=0.2, gzip;q=0.8'), 'gzip');
  assert.equal(negotiateEncoding('identity'), null);
});

test('subscriptions filter by subject and credential type', async () => {
  const hub = new SubscriptionHub({ authenticate: async ({ token }) => token === 'ok' });
  const received = [];
  await hub.subscribe({ topic: 'credentialUpdated', filter: { subject: 'G1', credentialType: 'kyc' }, credentials: { token: 'ok' }, onEvent: (event) => received.push(event) });
  hub.publish('credentialUpdated', { id: '1', subject: 'G1', credentialType: 'other' });
  hub.publish('credentialUpdated', { id: '2', subject: 'G1', credentialType: 'kyc' });
  hub.publish('credentialUpdated', { id: '3', subject: 'G2', credentialType: 'kyc' });
  assert.deepEqual(received.map((event) => event.id), ['2']);
});

test('subscription authentication is enforced and rate limiting closes a noisy subscriber', async () => {
  const hub = new SubscriptionHub({ authenticate: async () => false });
  await assert.rejects(() => hub.subscribe({ topic: 'didUpdated', credentials: {}, onEvent() {} }), /authentication failed/);
  const allowed = new SubscriptionHub({ authenticate: async () => true, maxEventsPerMinute: 1 });
  let closed = 0;
  await allowed.subscribe({ topic: 'didUpdated', onEvent() {}, onClose: () => { closed += 1; } });
  allowed.publish('didUpdated', { did: 'did:stellar:G1' });
  allowed.publish('didUpdated', { did: 'did:stellar:G1' });
  assert.equal(closed, 1);
});

test('Bull queue options provide exponential retries and priorities', () => {
  const options = createQueueOptions({ redisUrl: 'redis://localhost', queueAttempts: 4, queueBackoffMs: 250 });
  assert.equal(options.defaultJobOptions.attempts, 4);
  assert.deepEqual(options.defaultJobOptions.backoff, { type: 'exponential', delay: 250 });
  assert.equal(jobOptions('high').priority, 1);
  assert.equal(jobOptions('low').priority, 10);
});

test('dead-letter queue preserves failed job details', () => {
  const dlq = new DeadLetterQueue();
  const item = dlq.add({ id: 'job-1', data: { id: 1 } }, new Error('delivery failed'));
  assert.equal(item.error, 'delivery failed');
  assert.equal(dlq.list().length, 1);
});
