import test from 'node:test';
import assert from 'node:assert/strict';
import { warmCacheOnStartup } from '../src/cache/warming.js';

test('warmCacheOnStartup warms every available entry and logs completion', async () => {
  const events = [];
  const stats = await warmCacheOnStartup({
    entries: [
      { key: 'did:stellar:abc', load: async () => ({ id: 'abc' }) },
      { key: 'did:stellar:def', load: async () => null },
      { key: 'did:stellar:ghi', load: async () => ({ id: 'ghi' }) },
      { key: 'did:stellar:bad', load: async () => { throw new Error('boom'); } },
    ],
    concurrency: 2,
    logger: {
      info: (...args) => events.push(args),
      warn: (...args) => events.push(args),
    },
  });

  assert.equal(stats.warmed, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.total, 4);
  assert.ok(events.some(([payload]) => payload && payload.warmed === 2));
});
