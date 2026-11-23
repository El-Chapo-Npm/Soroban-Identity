import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JobQueue } from '../src/job-queue.js';
import { requestContextStore } from '../src/request-context.js';

function createRedisStub() {
  const values = new Map();
  return {
    values,
    async ping() { return true; },
    async command(command, args) {
      if (command === 'GET') return values.get(args[0]) ?? null;
      if (command === 'SET') {
        values.set(args[0], args[1]);
        return 'OK';
      }
      if (command === 'ZADD' || command === 'ZREM') return 1;
      throw new Error(`Unexpected Redis command: ${command}`);
    },
  };
}

test('persists request correlation and restores it while processing a queued job', async () => {
  const redis = createRedisStub();
  const queue = new JobQueue(redis, 'correlation-test');
  queue.processingTimeoutMs = 20;
  let workerContext;
  queue.onJob('verify', async () => {
    workerContext = requestContextStore.getStore();
    return { verified: true };
  });

  const correlationId = 'queued-correlation-123';
  const requestId = 'queued-request-456';
  const jobId = await requestContextStore.run(
    { requestId, correlationId, tenantId: 'tenant-1' },
    () => queue.addJob('verify', { credentialId: 'credential-1' }),
  );

  const jobKey = `queue:correlation-test:job:${jobId}`;
  const queuedJob = JSON.parse(redis.values.get(jobKey));
  assert.equal(queuedJob.requestId, requestId);
  assert.equal(queuedJob.correlationId, correlationId);
  assert.equal(queuedJob.tenantId, 'tenant-1');

  await queue._processJob(jobId);
  assert.equal(workerContext.requestId, requestId);
  assert.equal(workerContext.correlationId, correlationId);
  assert.equal(workerContext.tenantId, 'tenant-1');
  assert.deepEqual(JSON.parse(redis.values.get(jobKey)).result, { verified: true });
});
