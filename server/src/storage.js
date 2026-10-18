import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { requestContextStore } from './request-context.js';
import { logger } from './logger.js';
import { EventStore, createEvent, EventTypes } from './events/index.js';

let _eventStoreInstance = null;
function getEventStore(config) {
  if (!_eventStoreInstance) {
    _eventStoreInstance = new EventStore({ dataDir: `${config?.dataDir || './data'}/events` });
    void _eventStoreInstance.init();
  }
  return _eventStoreInstance;
}

// ── Event sourcing metrics (#1050) ───────────────────────────────────────────
/**
 * In-memory counters tracking event-sourcing health. Exposed via
 * getEventSourcingMetrics() so health/readiness endpoints can surface event
 * lag and store size without touching the event store on every probe.
 */
const _eventMetrics = {
  appended: 0,
  appendFailures: 0,
  rebuilds: 0,
  lastAppendAt: null,
  lastRebuildAt: null,
  lastEventLagMs: 0,
};

/**
 * Append a lifecycle event to the append-only event store, tolerating
 * failures so a broken event store never blocks the primary write path.
 *
 * @param {object} config
 * @param {object} eventInput - Arguments forwarded to createEvent()
 * @returns {Promise<object|null>} The appended event, or null on failure
 */
async function _appendLifecycleEvent(config, eventInput) {
  try {
    const eventStore = getEventStore(config);
    const event = await eventStore.append(createEvent(eventInput));
    _eventMetrics.appended += 1;
    _eventMetrics.lastAppendAt = new Date().toISOString();
    return event;
  } catch (e) {
    _eventMetrics.appendFailures += 1;
    logger.warn({ error: e.message, type: eventInput?.type }, 'Failed to append credential lifecycle event');
    return null;
  }
}

/**
 * Rebuild a credential's state by replaying its event stream from the
 * append-only store. Returns null when no events exist for the aggregate.
 *
 * @param {object} config
 * @param {string} id - Credential aggregate id
 * @returns {Promise<object|null>} The projected credential state
 */
export async function rebuildCredentialFromEvents(config, id) {
  const eventStore = getEventStore(config);
  const events = await eventStore.getEvents(id);
  if (!events || events.length === 0) return null;

  let state = null;
  for (const event of events) {
    state = applyCredentialEvent(state, event);
  }

  _eventMetrics.rebuilds += 1;
  _eventMetrics.lastRebuildAt = new Date().toISOString();
  if (events.length > 0) {
    const lastTs = Date.parse(events[events.length - 1].timestamp ?? events[events.length - 1].createdAt ?? '');
    if (Number.isFinite(lastTs)) {
      _eventMetrics.lastEventLagMs = Math.max(0, Date.now() - lastTs);
    }
  }
  return state;
}

/**
 * Pure projection function: fold a single event into the credential state.
 * Exported so read models and tests can reuse the same logic.
 *
 * @param {object|null} state
 * @param {object} event
 * @returns {object|null}
 */
export function applyCredentialEvent(state, event) {
  const payload = event?.payload ?? {};
  switch (event?.type) {
    case EventTypes.CREDENTIAL_ISSUED:
      return { ...payload, id: event.aggregateId, tenant_id: event.tenantId ?? payload.tenant_id ?? 'default', revoked: false };
    case EventTypes.CREDENTIAL_REVOKED:
      return { ...(state ?? { id: event.aggregateId }), revoked: true, revokedAt: payload.revokedAt ?? event.timestamp };
    case EventTypes.CREDENTIAL_SUSPENDED:
      return { ...(state ?? { id: event.aggregateId }), suspended: true, suspendedAt: payload.suspendedAt ?? event.timestamp };
    case EventTypes.CREDENTIAL_RENEWED:
      return { ...(state ?? { id: event.aggregateId }), ...payload, renewedAt: payload.renewedAt ?? event.timestamp };
    case EventTypes.CREDENTIAL_VERIFIED:
      return { ...(state ?? { id: event.aggregateId }), lastVerifiedAt: payload.verifiedAt ?? event.timestamp };
    default:
      return state;
  }
}

/**
 * Snapshot of event-sourcing health: append counters, rebuild counters and
 * event lag. Safe to call from health/readiness probes.
 *
 * @returns {object}
 */
export function getEventSourcingMetrics() {
  return { ..._eventMetrics };
}

/**
 * Report the on-disk size of the event store directory in bytes.
 * Returns 0 when the directory does not exist yet.
 *
 * @param {object} config
 * @returns {Promise<number>}
 */
export async function getEventStoreSize(config) {
  const dir = `${config?.dataDir || './data'}/events`;
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      total += stat.size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return total;
}

// ── StorageAdapter interface (#389) ──────────────────────────────────────────
// Custom adapters must export a default object implementing:
//   read(id)           → Promise<object|null>
//   write(id, data)    → Promise<void>
//   delete(id)         → Promise<boolean>
//   list()             → Promise<object[]>
//
// Set STORAGE_ADAPTER to the absolute path of a custom adapter module.
// When unset, the filesystem adapter below is used.

let _customAdapter = null;

export async function loadStorageAdapter() {
  const adapterPath = process.env.STORAGE_ADAPTER;
  if (!adapterPath) return null;
  const mod = await import(adapterPath);
  const adapter = mod.default ?? mod;
  for (const method of ['read', 'write', 'delete', 'list']) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`StorageAdapter at ${adapterPath} is missing method: ${method}`);
    }
  }
  _customAdapter = adapter;
  return adapter;
}

export function getStorageAdapter() { return _customAdapter; }

// ── Write-Ahead Log (WAL) for crash-safe storage ─────────────────────────────
/**
 * Atomically write data to a file using a write-ahead log pattern.
 * 1. Write to a temporary file (.tmp)
 * 2. Fully flush the temporary file
 * 3. Atomically rename it over the canonical file
 * 
 * @param {string} filePath - The target file path
 * @param {string} data - The data to write
 * @returns {Promise<void>}
 */
export async function writeAtomic(filePath, data) {
  // Unique suffix per call — prevents concurrent writers from clobbering
  // each other's temp file when writeAtomic is called for the same target
  // path simultaneously (e.g. two concurrent credential writes).
  const suffix = crypto.randomBytes(6).toString('hex');
  const tempPath = `${filePath}.${suffix}.tmp`;

  // Step 1: Write to temporary file
  await fs.writeFile(tempPath, data, 'utf8');

  // Step 2: Attempt to ensure the file is fully flushed (fsync on Unix)
  // Skip fsync on Windows where it may fail with EPERM
  if (process.platform !== 'win32') {
    const tempFile = await fs.open(tempPath, 'r');
    try {
      await tempFile.sync();
    } finally {
      await tempFile.close();
    }
  }

  // Step 3: Atomically rename
  await fs.rename(tempPath, filePath);
}

/**
 * Recover orphaned .tmp files on startup.
 * Should be called before accepting requests.
 * 
 * @param {string} filePath - The canonical file path to check for recovery
 * @returns {Promise<boolean>} True if recovery was performed, false otherwise
 */
export async function recoverOrphanedFile(filePath) {
  // Find any orphaned temp files matching the pattern <filePath>.<hex>.tmp
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  // Match files written by writeAtomic: <base>.tmp or <base>.<hex>.tmp
  const tempPattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[0-9a-f]{6})?\\.tmp$`);
  const orphans = entries.filter((e) => tempPattern.test(e));

  if (orphans.length === 0) return false;

  let canonicalExists = false;
  try {
    await fs.access(filePath);
    canonicalExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let recovered = false;
  for (const orphan of orphans) {
    const orphanPath = path.join(dir, orphan);
    if (!canonicalExists) {
      // Promote the first orphan to canonical; delete the rest
      logger.info({ filePath, orphanPath }, 'Recovering orphaned .tmp file');
      await fs.rename(orphanPath, filePath);
      canonicalExists = true;
      recovered = true;
    } else {
      logger.info({ filePath, orphanPath }, 'Cleaning up orphaned .tmp file (canonical exists)');
      await fs.unlink(orphanPath);
    }
  }

  return recovered;
}

let lastCheckedDate = null;

export async function cleanOldAuditLogs(config) {
  const dir = path.dirname(config.auditLogPath);
  const baseName = path.basename(config.auditLogPath);
  const escapedBaseName = baseName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`^${escapedBaseName}-(\\d{4}-\\d{2}-\\d{2})\\.ndjson$`);

  try {
    const files = await fs.readdir(dir);
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    for (const file of files) {
      const match = file.match(regex);
      if (!match) continue;

      const dateStr = match[1];
      const parts = dateStr.split('-');
      const fileYear = parseInt(parts[0], 10);
      const fileMonth = parseInt(parts[1], 10) - 1;
      const fileDay = parseInt(parts[2], 10);
      const fileUtc = Date.UTC(fileYear, fileMonth, fileDay);

      const ageInMs = todayUtc - fileUtc;
      const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

      if (ageInDays > config.auditLogRetentionDays) {
        await fs.unlink(path.join(dir, file));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error({ error: error.message, stack: error.stack, dir }, 'Failed to clean old audit logs');
    }
  }
}

export const TTL_MS = Number(process.env.CREDENTIAL_CACHE_TTL_MS ?? 5000);

/**
 * Per-path credential cache.
 * Keyed by the resolved credentialStorePath so that two different configs
 * pointing at different files never share cached data.
 *
 * Each entry: { credentials: Array, timestamp: number }
 */
const _credentialCacheMap = new Map();

export function clearCredentialCache(config) {
  if (config?.credentialStorePath) {
    _credentialCacheMap.delete(path.resolve(config.credentialStorePath));
  } else {
    // No config supplied — clear everything (used by tests that want a full reset)
    _credentialCacheMap.clear();
  }
}

export async function ensureDataDir(config) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(path.dirname(config.auditLogPath), { recursive: true });
  await fs.mkdir(path.dirname(config.credentialStorePath), { recursive: true });
  await cleanOldAuditLogs(config);
  
  // Recover orphaned .tmp files on startup
  const recovered = await recoverOrphanedFile(config.credentialStorePath);
  if (recovered) {
    clearCredentialCache(config);
  }
}

export async function appendAuditLog(config, entry) {
  const dateString = new Date().toISOString().split('T')[0];
  const currentLogPath = `${config.auditLogPath}-${dateString}.ndjson`;

  if (lastCheckedDate !== dateString) {
    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    lastCheckedDate = dateString;
  }

  const context = requestContextStore.getStore();
  const tenant_id = entry.tenant_id || context?.tenantId || config?.tenantId || 'default';
  const requestId = entry.requestId ?? context?.requestId ?? context?.correlationId;
  const correlationId = entry.correlationId ?? context?.correlationId ?? requestId;
  const record = {
    timestamp: new Date().toISOString(),
    tenant_id,
    ...entry,
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
  const line = `${JSON.stringify(record)}\n`;

  // Acquire a per-file mutex so concurrent callers queue up and each write
  // lands as a complete NDJSON line rather than being interleaved.
  const release = await _acquireFileLock(currentLogPath);
  try {
    await fs.appendFile(currentLogPath, line, 'utf8');
  } finally {
    release();
  }

  return record;
}

// ---------------------------------------------------------------------------
// Minimal per-path mutex — no external dependencies required.
// Each entry in the map is a Promise chain; callers append to the tail so they
// execute one at a time for a given file path.
// Used by both appendAuditLog and the credential read-modify-write path.
// ---------------------------------------------------------------------------
const _fileLocks = new Map();

/**
 * Track the number of waiters queued per file path so we can warn if the
 * queue grows too deep (indicating a slow disk or a runaway caller).
 */
const _fileLockDepth = new Map();

/** Emit a warning when the queue depth for any single file exceeds this limit. */
const FILE_LOCK_WARN_DEPTH = 1000;

/**
 * Acquire an exclusive write lock for `filePath`.
 * Returns a release function that MUST be called (in a finally block) to
 * unblock the next waiter.
 *
 * @param {string} filePath
 * @returns {Promise<() => void>}
 */
function _acquireFileLock(filePath) {
  const current = _fileLocks.get(filePath) ?? Promise.resolve();

  const depth = (_fileLockDepth.get(filePath) ?? 0) + 1;
  _fileLockDepth.set(filePath, depth);
  if (depth > FILE_LOCK_WARN_DEPTH) {
    console.warn(
      `[_acquireFileLock] Write queue depth for "${filePath}" is ${depth}, ` +
        `which exceeds the warning threshold of ${FILE_LOCK_WARN_DEPTH}. ` +
        'The disk may be slow or callers are overwhelming this path.',
    );
  }

  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });

  _fileLocks.set(filePath, current.then(() => next));

  return current.then(() => {
    _fileLockDepth.set(filePath, (_fileLockDepth.get(filePath) ?? 1) - 1);
    return release;
  });
}

export async function readCredentials(config) {
  const storePath = path.resolve(config.credentialStorePath);
  const now = Date.now();
  const cached = _credentialCacheMap.get(storePath);
  if (cached !== undefined && now - cached.timestamp < TTL_MS) {
    return cached.credentials;
  }
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    const credentials = Array.isArray(parsed.credentials) ? parsed.credentials : [];
    _credentialCacheMap.set(storePath, { credentials, timestamp: now });
    return credentials;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const credentials = [];
      _credentialCacheMap.set(storePath, { credentials, timestamp: now });
      return credentials;
    }
    throw error;
  }
}

export async function writeCredentials(config, credentials) {
  await ensureDataDir(config);
  await writeAtomic(config.credentialStorePath, JSON.stringify({ credentials }, null, 2));
  _credentialCacheMap.delete(path.resolve(config.credentialStorePath));
}

/**
 * Atomically create a new credential under a per-file mutex.
 *
 * Callers MUST use this instead of the bare readCredentials →
 * createCredential → writeCredentials sequence to avoid the lost-update
 * race: two concurrent requests reading the same snapshot and each
 * writing back only their own addition, silently discarding the other.
 *
 * Throws DuplicateCredentialError if a credential with the same id already
 * exists (consistent with the pure createCredential helper).
 *
 * @param {object} config
 * @param {object} credential
 * @returns {Promise<object[]>} The updated credentials array
 */
export async function createAndPersistCredential(config, credential) {
  const storePath = path.resolve(config.credentialStorePath);
  const release = await _acquireFileLock(storePath);
  try {
    // Re-read inside the lock — gets the freshest state regardless of cache
    const current = await readCredentials(config);
    const updated = createCredential(current, credential); // throws DuplicateCredentialError
    await writeCredentials(config, updated);

    // Event Sourcing immutable audit log (#802, #1050)
    const createdItem = updated[updated.length - 1];
    await _appendLifecycleEvent(config, {
      type: EventTypes.CREDENTIAL_ISSUED,
      aggregateId: credential.id,
      aggregateType: 'Credential',
      tenantId: createdItem.tenant_id || config.tenantId || 'default',
      payload: { ...credential },
    });

    return updated;
  } finally {
    release();
  }
}

export function upsertCredential(credentials, credential) {
  const index = credentials.findIndex((item) => item.id === credential.id);
  if (index === -1) return [...credentials, credential];
  const next = credentials.map((c) => ({ ...c }));
  next[index] = { ...next[index], ...credential };
  return next;
}

export class DuplicateCredentialError extends Error {
  constructor(id) {
    super(`Credential with ID "${id}" already exists`);
    this.name = 'DuplicateCredentialError';
    this.id = id;
  }
}

export function createCredential(credentials, credential) {
  if (credentials.some((item) => item.id === credential.id)) {
    throw new DuplicateCredentialError(credential.id);
  }
  const context = requestContextStore.getStore();
  const tenant_id = credential.tenant_id || context?.tenantId || 'default';
  const itemWithTenant = { tenant_id, ...credential };
  return [...credentials, itemWithTenant];
}

/**
 * Atomically mark a credential as revoked under a per-file mutex.
 *
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>} The revoked credential or null if not found
 */
export async function revokeAndPersistCredential(config, id) {
  const storePath = path.resolve(config.credentialStorePath);
  const release = await _acquireFileLock(storePath);
  try {
    const current = await readCredentials(config);
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const revokedAt = new Date().toISOString();
    const updated = current.map((c) => (c.id === id ? { ...c, revoked: true, revokedAt } : { ...c }));
    await writeCredentials(config, updated);

    // Event Sourcing immutable audit log (#802, #1050)
    const revokedItem = updated[index];
    await _appendLifecycleEvent(config, {
      type: EventTypes.CREDENTIAL_REVOKED,
      aggregateId: id,
      aggregateType: 'Credential',
      tenantId: revokedItem.tenant_id || config.tenantId || 'default',
      payload: { revokedAt },
    });

    return updated[index];
  } finally {
    release();
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(id, expectedVersion, currentVersion) {
    super(`Conflict updating credential "${id}": expected version ${expectedVersion}, but current version is ${currentVersion}`);
    this.name = 'ConcurrencyConflictError';
    this.id = id;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

/**
 * Atomically update an existing credential under a per-file mutex with optimistic concurrency control.
 *
 * @param {object} config
 * @param {string} id
 * @param {object} updates
 * @param {number|string|undefined} expectedVersion
 * @returns {Promise<object|null>} The updated credential or null if not found
 */
export async function updateAndPersistCredential(config, id, updates, expectedVersion = undefined) {
  const storePath = path.resolve(config.credentialStorePath);
  const release = await _acquireFileLock(storePath);
  try {
    const current = await readCredentials(config);
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const existing = current[index];
    const currentVersion = existing.version ?? existing.updatedAt ?? existing.issuedAt ?? 1;

    if (expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== String(currentVersion)) {
      throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
    }

    const updatedAt = new Date().toISOString();
    const nextVersion = typeof currentVersion === 'number' ? currentVersion + 1 : (Number.isFinite(Number(currentVersion)) ? Number(currentVersion) + 1 : Date.now());
    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      version: nextVersion,
      updatedAt,
    };

    const nextList = [...current];
    nextList[index] = updated;
    await writeCredentials(config, nextList);

    // Event Sourcing immutable audit log (#1050) — emit a lifecycle event
    // matching the semantic change so the event stream stays authoritative.
    const tenantId = updated.tenant_id || config.tenantId || 'default';
    if (updates?.suspended === true && existing.suspended !== true) {
      await _appendLifecycleEvent(config, {
        type: EventTypes.CREDENTIAL_SUSPENDED,
        aggregateId: id,
        aggregateType: 'Credential',
        tenantId,
        payload: { suspendedAt: updatedAt },
      });
    } else if (updates?.suspended === false && existing.suspended === true) {
      await _appendLifecycleEvent(config, {
        type: EventTypes.CREDENTIAL_RENEWED,
        aggregateId: id,
        aggregateType: 'Credential',
        tenantId,
        payload: { resumedAt: updatedAt, ...updates },
      });
    } else if (updates?.renewed === true || updates?.renewedAt) {
      await _appendLifecycleEvent(config, {
        type: EventTypes.CREDENTIAL_RENEWED,
        aggregateId: id,
        aggregateType: 'Credential',
        tenantId,
        payload: { renewedAt: updates.renewedAt ?? updatedAt, ...updates },
      });
    } else if (updates?.verified === true || updates?.verifiedAt) {
      await _appendLifecycleEvent(config, {
        type: EventTypes.CREDENTIAL_VERIFIED,
        aggregateId: id,
        aggregateType: 'Credential',
        tenantId,
        payload: { verifiedAt: updates.verifiedAt ?? updatedAt },
      });
    }

    return updated;
  } finally {
    release();
  }
}

/**
 * Atomically mark a credential as suspended under a per-file mutex and
 * append a CredentialSuspended lifecycle event (#1050).
 *
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>} The suspended credential or null if not found
 */
export async function suspendAndPersistCredential(config, id) {
  const storePath = path.resolve(config.credentialStorePath);
  const release = await _acquireFileLock(storePath);
  try {
    const current = await readCredentials(config);
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const suspendedAt = new Date().toISOString();
    const updated = current.map((c) => (c.id === id ? { ...c, suspended: true, suspendedAt } : { ...c }));
    await writeCredentials(config, updated);

    const suspendedItem = updated[index];
    await _appendLifecycleEvent(config, {
      type: EventTypes.CREDENTIAL_SUSPENDED,
      aggregateId: id,
      aggregateType: 'Credential',
      tenantId: suspendedItem.tenant_id || config.tenantId || 'default',
      payload: { suspendedAt },
    });

    return updated[index];
  } finally {
    release();
  }
}

/**
 * Atomically renew a credential under a per-file mutex and append a
 * CredentialRenewed lifecycle event (#1050).
 *
 * @param {object} config
 * @param {string} id
 * @param {object} updates - Renewal fields (e.g. expiresAt)
 * @returns {Promise<object|null>} The renewed credential or null if not found
 */
export async function renewAndPersistCredential(config, id, updates = {}) {
  const storePath = path.resolve(config.credentialStorePath);
  const release = await _acquireFileLock(storePath);
  try {
    const current = await readCredentials(config);
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const renewedAt = new Date().toISOString();
    const updated = current.map((c) => (c.id === id ? { ...c, ...updates, renewedAt, suspended: false } : { ...c }));
    await writeCredentials(config, updated);

    const renewedItem = updated[index];
    await _appendLifecycleEvent(config, {
      type: EventTypes.CREDENTIAL_RENEWED,
      aggregateId: id,
      aggregateType: 'Credential',
      tenantId: renewedItem.tenant_id || config.tenantId || 'default',
      payload: { renewedAt, ...updates },
    });

    return updated[index];
  } finally {
    release();
  }
}

/**
 * Record a credential verification in the event stream (#1050). Verification
 * does not mutate the credential store, so only the event is appended.
 *
 * @param {object} config
 * @param {string} id
 * @param {object} details
 * @returns {Promise<object|null>} The appended event or null on failure
 */
export async function recordCredentialVerification(config, id, details = {}) {
  const verifiedAt = new Date().toISOString();
  return _appendLifecycleEvent(config, {
    type: EventTypes.CREDENTIAL_VERIFIED,
    aggregateId: id,
    aggregateType: 'Credential',
    tenantId: details.tenant_id || config.tenantId || 'default',
    payload: { verifiedAt, ...details },
  });
}



// ── Expiry scanner watermark persistence ──────────────────────────────────────
/**
 * Get the path where the expiry watermark is stored.
 * 
 * @param {Object} config - Configuration object with dataDir
 * @returns {string} Path to the watermark file
 */
export function getExpiryWatermarkPath(config) {
  return path.join(config.dataDir, 'expiry-watermark.json');
}

/**
 * Read the persisted expiry watermark (next ledger to scan).
 * Returns null if the watermark file doesn't exist.
 * 
 * @param {Object} config - Configuration object
 * @returns {Promise<number|null>} The next ledger to scan, or null if not persisted
 */
export async function readExpiryWatermark(config) {
  const filePath = getExpiryWatermarkPath(config);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const nextLedger = Number(parsed.nextLedger);
    if (Number.isFinite(nextLedger)) {
      return nextLedger;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    logger.warn({ error: error.message, filePath }, 'Failed to read expiry watermark, will use default');
  }
  return null;
}

/**
 * Persist the expiry watermark (next ledger to scan).
 * Uses atomic write-ahead log pattern for crash-safety.
 * 
 * @param {Object} config - Configuration object
 * @param {number} nextLedger - The next ledger to scan
 * @returns {Promise<void>}
 */
export async function writeExpiryWatermark(config, nextLedger) {
  await ensureDataDir(config);
  const filePath = getExpiryWatermarkPath(config);
  await writeAtomic(filePath, JSON.stringify({ nextLedger }, null, 2));
}
