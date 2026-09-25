import { EventEmitter } from 'node:events';

export const JOB_TYPES = Object.freeze({ WEBHOOK: 'webhook-delivery', NOTIFICATION: 'notification', BATCH: 'batch-credential-processing' });
export const JOB_PRIORITIES = Object.freeze({ high: 1, normal: 5, low: 10 });

export function createQueueOptions(config = {}) {
  if (!config.redisUrl) throw new Error('REDIS_URL is required for Bull queues');
  return {
    redis: config.redisUrl,
    defaultJobOptions: {
      attempts: config.queueAttempts ?? 5,
      backoff: { type: 'exponential', delay: config.queueBackoffMs ?? 1000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: false,
    },
  };
}

export class DeadLetterQueue extends EventEmitter {
  constructor() { super(); this.jobs = []; }
  add(job, error) { const item = { ...job, failedAt: new Date().toISOString(), error: error?.message || String(error) }; this.jobs.push(item); this.emit('failed', item); return item; }
  list() { return [...this.jobs]; }
}

export async function createBullQueues({ config, processors = {}, QueueCtor } = {}) {
  const Queue = QueueCtor ?? (await import('bull')).default;
  const deadLetter = new DeadLetterQueue();
  const queues = {};
  for (const [key, name] of Object.entries(JOB_TYPES)) {
    const queue = new Queue(name, { redis: config.redisUrl, defaultJobOptions: createQueueOptions(config).defaultJobOptions });
    queue.process(config.queueConcurrency ?? 4, async (job) => {
      const processor = processors[name];
      if (!processor) throw new Error(`No processor registered for ${name}`);
      const result = await processor(job.data, { job, reportProgress: (value) => job.updateProgress(value) });
      return result;
    });
    queue.on('failed', (job, error) => { if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) deadLetter.add(job, error); });
    queues[key.toLowerCase()] = { queue };
  }
  return { queues, deadLetter, close: async () => Promise.all(Object.values(queues).map(({ queue }) => queue.close())) };
}

export function jobOptions(priority = 'normal') {
  return { priority: JOB_PRIORITIES[priority] ?? JOB_PRIORITIES.normal };
}
