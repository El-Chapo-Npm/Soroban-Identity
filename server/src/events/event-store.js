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
  }

  async init() {
    if (this._initialized) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });
    this._initialized = true;
  }

  async append(event) {
    await this.init();
    const serialized = EventSerializer.serialize(event);
    const line = `${serialized}\n`;

    // Mutex write to ensure append-only consistency
    let release;
    const nextLock = new Promise((resolve) => { release = resolve; });
    const currentLock = this._lock;
    this._lock = currentLock.then(() => nextLock);

    try {
      await currentLock;
      await fs.appendFile(this.eventsFilePath, line, 'utf8');
    } finally {
      release();
    }

    // Emit live event for real-time subscribers
    this.emit('event', event);
    this.emit(`event:${event.type}`, event);
    if (event.tenantId) {
      this.emit(`tenant:${event.tenantId}`, event);
    }

    return event;
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
