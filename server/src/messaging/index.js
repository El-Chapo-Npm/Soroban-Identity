import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Message broker abstraction for async processing (issue #1113).
 *
 * The in-process `MessageBroker` implements the same semantics we rely on
 * from RabbitMQ (priority queues, DLQs, persistence) so the server works
 * without external infrastructure in dev/test. `createBroker()` selects the
 * RabbitMQ adapter when `MESSAGE_BROKER_URL` is set.
 *
 * Features:
 *   - priority queues (higher `priority` delivered first, FIFO within priority)
 *   - deduplication by `dedupKey` (or content hash) inside a sliding window
 *   - per-`orderingKey` ordering: one in-flight message per key
 *   - retries with exponential backoff + jitter, then dead-letter queue
 *   - optional JSON-lines persistence with replay on startup
 *   - consumer scaling (`setConcurrency`) and queue monitoring/alerting
 */

export const QUEUES = Object.freeze({
  CREDENTIAL_ISSUANCE: 'credential.issuance',
  VERIFICATION: 'credential.verification',
  NOTIFICATION: 'notification',
  BATCH: 'batch.processing',
  ANALYTICS: 'analytics.events',
});

export const PRIORITY = Object.freeze({ LOW: 0, NORMAL: 5, HIGH: 8, URGENT: 10 });

export function backoffDelay(attempt, { baseMs = 500, maxMs = 60_000, jitter = 0.2 } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = exp * jitter;
  return Math.max(0, Math.round(exp - spread + Math.random() * spread * 2));
}

class Queue {
  constructor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.pending = [];
    this.inflight = new Map();
    this.orderingLocks = new Set();
    this.dedup = new Map();
    this.handler = null;
    this.concurrency = opts.concurrency;
    this.stats = { published: 0, acked: 0, retried: 0, deadLettered: 0, duplicates: 0 };
  }

  enqueue(msg) {
    // Stable insertion: after all messages with >= priority.
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].priority < msg.priority) i--;
    this.pending.splice(i, 0, msg);
  }

  next() {
    const now = Date.now();
    for (let i = 0; i < this.pending.length; i++) {
      const m = this.pending[i];
      if (m.availableAt > now) continue;
      if (m.orderingKey && this.orderingLocks.has(m.orderingKey)) continue;
      this.pending.splice(i, 1);
      return m;
    }
    return null;
  }
}

export class MessageBroker extends EventEmitter {
  #queues = new Map();
  #timers = new Set();
  #persistPath;
  #closed = false;

  constructor({
    persistDir = null,
    maxRetries = 5,
    dedupWindowMs = 5 * 60_000,
    backoff = {},
    alertThresholds = { depth: 1000, deadLetters: 10 },
  } = {}) {
    super();
    this.maxRetries = maxRetries;
    this.dedupWindowMs = dedupWindowMs;
    this.backoff = backoff;
    this.alertThresholds = alertThresholds;
    this.#persistPath = persistDir ? path.join(persistDir, 'messages.jsonl') : null;
    if (this.#persistPath) this.#replay();
  }

  assertQueue(name, { concurrency = 1, maxRetries = this.maxRetries } = {}) {
    if (!this.#queues.has(name)) {
      this.#queues.set(name, new Queue(name, { concurrency, maxRetries }));
      this.#queues.set(`${name}.dlq`, new Queue(`${name}.dlq`, { concurrency: 1, maxRetries: 0 }));
    }
    return this.#queues.get(name);
  }

  publish(queueName, payload, { priority = PRIORITY.NORMAL, dedupKey, orderingKey, delayMs = 0 } = {}) {
    if (this.#closed) throw new Error('broker closed');
    const q = this.assertQueue(queueName);
    const key = dedupKey ?? crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const now = Date.now();
    for (const [k, t] of q.dedup) if (now - t > this.dedupWindowMs) q.dedup.delete(k);
    if (q.dedup.has(key)) {
      q.stats.duplicates++;
      return null;
    }
    q.dedup.set(key, now);
    const msg = {
      id: crypto.randomUUID(),
      queue: queueName,
      payload,
      priority,
      orderingKey: orderingKey ?? null,
      attempts: 0,
      publishedAt: now,
      availableAt: now + delayMs,
    };
    q.enqueue(msg);
    q.stats.published++;
    this.#persist({ op: 'publish', msg });
    this.#checkAlerts(q);
    this.#pump(q);
    return msg.id;
  }

  consume(queueName, handler, { concurrency } = {}) {
    const q = this.assertQueue(queueName);
    q.handler = handler;
    if (concurrency) q.concurrency = concurrency;
    this.#pump(q);
    return () => { q.handler = null; };
  }

  /** Scale consumers for a queue up or down at runtime. */
  setConcurrency(queueName, n) {
    const q = this.assertQueue(queueName);
    q.concurrency = Math.max(1, n);
    this.#pump(q);
  }

  /** Re-publish everything from a DLQ back onto its source queue. */
  redriveDeadLetters(queueName) {
    const dlq = this.assertQueue(`${queueName}.dlq`);
    const src = this.assertQueue(queueName);
    let n = 0;
    while (dlq.pending.length) {
      const m = dlq.pending.shift();
      src.enqueue({ ...m, queue: queueName, attempts: 0, availableAt: Date.now() });
      n++;
    }
    this.#pump(src);
    return n;
  }

  stats() {
    const out = {};
    for (const [name, q] of this.#queues) {
      out[name] = { depth: q.pending.length, inflight: q.inflight.size, concurrency: q.concurrency, ...q.stats };
    }
    return out;
  }

  /** Prometheus text exposition for queue monitoring. */
  metricsText() {
    const lines = [
      '# HELP mq_queue_depth Messages waiting in queue',
      '# TYPE mq_queue_depth gauge',
    ];
    for (const [name, s] of Object.entries(this.stats())) {
      lines.push(`mq_queue_depth{queue="${name}"} ${s.depth}`);
      lines.push(`mq_messages_acked_total{queue="${name}"} ${s.acked}`);
      lines.push(`mq_messages_dead_lettered_total{queue="${name}"} ${s.deadLettered}`);
    }
    return lines.join('\n') + '\n';
  }

  async drain(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const busy = [...this.#queues.values()].some(
        (q) => q.inflight.size || (q.handler && q.pending.length),
      );
      if (!busy) return true;
      await new Promise((r) => setTimeout(r, 5));
    }
    return false;
  }

  close() {
    this.#closed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }

  #pump(q) {
    if (!q.handler || this.#closed) return;
    while (q.inflight.size < q.concurrency) {
      const msg = q.next();
      if (!msg) break;
      this.#deliver(q, msg);
    }
    const nextAt = q.pending.reduce((min, m) => Math.min(min, m.availableAt), Infinity);
    if (Number.isFinite(nextAt) && nextAt > Date.now()) this.#schedule(q, nextAt - Date.now());
  }

  #schedule(q, ms) {
    const t = setTimeout(() => { this.#timers.delete(t); this.#pump(q); }, ms);
    this.#timers.add(t);
  }

  async #deliver(q, msg) {
    msg.attempts++;
    q.inflight.set(msg.id, msg);
    if (msg.orderingKey) q.orderingLocks.add(msg.orderingKey);
    try {
      await q.handler(msg.payload, { id: msg.id, attempts: msg.attempts, queue: q.name });
      q.stats.acked++;
      this.#persist({ op: 'ack', id: msg.id });
    } catch (err) {
      if (msg.attempts > q.opts.maxRetries) {
        const dlq = this.assertQueue(`${q.name}.dlq`);
        dlq.enqueue({ ...msg, queue: dlq.name, error: String(err?.message ?? err) });
        q.stats.deadLettered++;
        this.#persist({ op: 'dead', id: msg.id });
        this.emit('dead-letter', { queue: q.name, msg, err });
        this.#checkAlerts(q);
      } else {
        q.stats.retried++;
        msg.availableAt = Date.now() + backoffDelay(msg.attempts, this.backoff);
        q.enqueue(msg);
      }
    } finally {
      q.inflight.delete(msg.id);
      if (msg.orderingKey) q.orderingLocks.delete(msg.orderingKey);
      this.#pump(q);
    }
  }

  #checkAlerts(q) {
    if (q.pending.length >= this.alertThresholds.depth) {
      this.emit('alert', { type: 'queue_depth', queue: q.name, value: q.pending.length });
    }
    if (q.stats.deadLettered >= this.alertThresholds.deadLetters) {
      this.emit('alert', { type: 'dead_letters', queue: q.name, value: q.stats.deadLettered });
    }
  }

  #persist(entry) {
    if (!this.#persistPath) return;
    fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
    fs.appendFileSync(this.#persistPath, JSON.stringify(entry) + '\n');
  }

  #replay() {
    if (!fs.existsSync(this.#persistPath)) return;
    const open = new Map();
    for (const line of fs.readFileSync(this.#persistPath, 'utf8').split('\n')) {
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.op === 'publish') open.set(e.msg.id, e.msg);
      else open.delete(e.id);
    }
    for (const msg of open.values()) {
      const q = this.assertQueue(msg.queue);
      q.enqueue({ ...msg, availableAt: Date.now() });
    }
    // Compact the log down to the still-unacked messages.
    fs.writeFileSync(
      this.#persistPath,
      [...open.values()].map((msg) => JSON.stringify({ op: 'publish', msg }) + '\n').join(''),
    );
  }
}

/**
 * RabbitMQ adapter. Loaded lazily so `amqplib` stays an optional dependency.
 * Declares each queue durable with a DLX and `x-max-priority`.
 */
export async function createRabbitBroker(url, { prefetch = 10 } = {}) {
  const amqp = await import('amqplib');
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.prefetch(prefetch);
  const declared = new Set();
  async function declare(name) {
    if (declared.has(name)) return;
    await ch.assertQueue(`${name}.dlq`, { durable: true });
    await ch.assertQueue(name, {
      durable: true,
      maxPriority: PRIORITY.URGENT,
      deadLetterExchange: '',
      deadLetterRoutingKey: `${name}.dlq`,
    });
    declared.add(name);
  }
  return {
    async publish(queue, payload, { priority = PRIORITY.NORMAL, dedupKey } = {}) {
      await declare(queue);
      return ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
        persistent: true,
        priority,
        messageId: dedupKey ?? crypto.randomUUID(),
      });
    },
    async consume(queue, handler) {
      await declare(queue);
      await ch.consume(queue, async (m) => {
        try {
          await handler(JSON.parse(m.content.toString()), { id: m.properties.messageId });
          ch.ack(m);
        } catch {
          ch.nack(m, false, false);
        }
      });
    },
    close: () => conn.close(),
  };
}

export async function createBroker(env = process.env) {
  if (env.MESSAGE_BROKER_URL) return createRabbitBroker(env.MESSAGE_BROKER_URL);
  const broker = new MessageBroker({ persistDir: env.MESSAGE_BROKER_DATA_DIR || null });
  for (const q of Object.values(QUEUES)) broker.assertQueue(q);
  return broker;
}
