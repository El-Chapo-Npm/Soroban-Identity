import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EventSerializer } from './event-schema.js';
import { logger } from '../logger.js';

/**
 * Append-only Event Store with file persistence, snapshots, retention, and live subscriber stream.
 */
export class EventStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = options.dataDir || './data/events';
    this.eventsFilePath = options.eventsFilePath || path.join(this.dataDir, 'events.ndjson');
    this.snapshotsFilePath = options.snapshotsFilePath || path.join(this.dataDir, 'snapshots.json');
    this.archiveDir = path.join(this.dataDir, 'archived');
    this.retentionDays = options.retentionDays || 90;
    this.snapshotInterval = options.snapshotInterval || 50; // Snapshot every 50 events per aggregate
    this._initialized = false;
    this._lock = Promise.resolve();
    this._sequence = 0; // Monotonic global sequence number
    this._subscribers = new Set(); // Live stream subscribers
    this._lastAppendAt = null;
  }

  async init() {
    if (this._initialized) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });
    this._initialized = true;
  }

  async append(event) {
    await this.init();

    // Mutex write to ensure append-only consistency
    let release;
    const nextLock = new Promise((resolve) => { release = resolve; });
    const currentLock = this._lock;
    this._lock = currentLock.then(() => nextLock);

    let stored;
    try {
      await currentLock;
      // Assign monotonic sequence and freeze the record to keep it immutable
      this._sequence += 1;
      stored = Object.freeze({
        ...event,
        sequence: this._sequence,
        recordedAt: new Date().toISOString(),
      });
      const serialized = EventSerializer.serialize(stored);
      const line = `${serialized}\n`;
      await fs.appendFile(this.eventsFilePath, line, 'utf8');
      this._lastAppendAt = Date.now();
    } finally {
      release();
    }

    // Emit live event for real-time subscribers
    this.emit('event', stored);
    this.emit(`event:${stored.type}`, stored);
    if (stored.tenantId) {
      this.emit(`tenant:${stored.tenantId}`, stored);
    }

    // Notify live stream subscribers
    for (const subscriber of this._subscribers) {
      try {
        subscriber(stored);
      } catch (err) {
        logger.warn({ err }, 'Event store subscriber threw during dispatch');
      }
    }

    return stored;
  }

  /**
   * Subscribe to the live stream of newly appended events.
   * Returns an unsubscribe function.
   */
  subscribe(handler, { filter = null } = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('EventStore.subscribe requires a handler function');
    }
    const wrapped = (event) => {
      if (filter && !filter(event)) return;
      handler(event);
    };
    this._subscribers.add(wrapped);
    return () => {
      this._subscribers.delete(wrapped);
    };
  }

  /**
   * Stream events from a given sequence (exclusive) onward, invoking handler for each.
   */
  async streamFrom(sequence, handler) {
    const events = await this.getEvents();
    const ordered = events
      .filter((e) => typeof e.sequence === 'number' && e.sequence > sequence)
      .sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      await handler(event);
    }
    return ordered.length;
  }

  /**
   * Expose metrics about store size and event lag.
   */
  async getMetrics() {
    const events = await this.getEvents();
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const lastTimestamp = lastEvent ? new Date(lastEvent.timestamp).getTime() : null;
    const lagMs = lastTimestamp ? Date.now() - lastTimestamp : 0;
    return {
      eventCount: events.length,
      sequence: this._sequence,
      subscriberCount: this._subscribers.size,
      lastAppendAt: this._lastAppendAt ? new Date(this._lastAppendAt).toISOString() : null,
      lastEventTimestamp: lastEvent ? lastEvent.timestamp : null,
      eventLagMs: lagMs,
    };
  }

  /**
   * Read events for an aggregate or tenant with optional starting version/offset
   */
  async getEvents({ aggregateId = null, tenantId = null, fromTimestamp = null } = {}) {
    await this.init();
    try {
      const raw = await fs.readFile(this.eventsFilePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const events = [];

      for (const line of lines) {
        try {
          const event = EventSerializer.deserialize(line);
          if (aggregateId && event.aggregateId !== aggregateId) continue;
          if (tenantId && event.tenantId !== tenantId) continue;
          if (fromTimestamp && new Date(event.timestamp) < new Date(fromTimestamp)) continue;
          events.push(event);
          if (typeof event.sequence === 'number' && event.sequence > this._sequence) {
            this._sequence = event.sequence;
          }
        } catch {
          // ignore corrupted lines
        }
      }

      return events;
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Save aggregate snapshot for performance
   */
  async saveSnapshot(aggregateId, state, version) {
    await this.init();
    const snapshots = await this.readSnapshots();
    snapshots[aggregateId] = {
      aggregateId,
      state,
      version,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.snapshotsFilePath, JSON.stringify(snapshots, null, 2), 'utf8');
  }

  async readSnapshots() {
    try {
      const raw = await fs.readFile(this.snapshotsFilePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async getSnapshot(aggregateId) {
    const snapshots = await this.readSnapshots();
    return snapshots[aggregateId] || null;
  }

  /**
   * Archive older events exceeding retention policy
   */
  async runRetentionArchive() {
    await this.init();
    const now = Date.now();
    const cutoffMs = now - (this.retentionDays * 24 * 60 * 60 * 1000);

    const allEvents = await this.getEvents();
    const toKeep = [];
    const toArchive = [];

    for (const evt of allEvents) {
      if (new Date(evt.timestamp).getTime() < cutoffMs) {
        toArchive.push(evt);
      } else {
        toKeep.push(evt);
      }
    }

    if (toArchive.length > 0) {
      const archiveFilename = `archive-${new Date().toISOString().split('T')[0]}-${Date.now()}.ndjson`;
      const archivePath = path.join(this.archiveDir, archiveFilename);
      const archiveContent = toArchive.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.writeFile(archivePath, archiveContent, 'utf8');

      // Re-write events file with active retained events
      const activeContent = toKeep.map((e) => JSON.stringify(e)).join('\n') + (toKeep.length > 0 ? '\n' : '');
      await fs.writeFile(this.eventsFilePath, activeContent, 'utf8');
      logger.info({ archivedCount: toArchive.length, keptCount: toKeep.length }, 'Completed event store retention archive');
    }

    return { archived: toArchive.length, retained: toKeep.length };
  }
}
