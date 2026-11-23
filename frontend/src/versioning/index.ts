import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialSnapshot {
  [key: string]: unknown;
}

export interface VersionMetadata {
  credentialId: string;
  version: number;
  timestamp: number;
  author: string;
  reason: string;
  annotation?: string;
  parentVersion: number | null;
  branch: string;
  snapshot: CredentialSnapshot;
}

export interface VersionKey {
  credentialId: string;
  version: number;
}

export type FieldChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FieldDiff {
  field: string;
  type: FieldChangeType;
  from: unknown;
  to: unknown;
}

export interface ClaimDiff {
  claim: string;
  type: FieldChangeType;
  from: unknown;
  to: unknown;
}

export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  fields: FieldDiff[];
  claims: ClaimDiff[];
  hasChanges: boolean;
}

export interface CreateVersionInput {
  credentialId: string;
  snapshot: CredentialSnapshot;
  author?: string;
  reason?: string;
  annotation?: string;
  parentVersion?: number | null;
  branch?: string;
}

export interface RestoreOptions {
  author?: string;
  reason?: string;
  annotation?: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (reuse existing offlineStorage DB)
// ---------------------------------------------------------------------------

const DB_NAME = 'offlineStorage';
const DB_VERSION = 2;
const STORE_NAME = 'credential-versions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ['credentialId', 'version'],
        });
        store.createIndex('byCredential', 'credentialId', { unique: false });
        store.createIndex('byBranch', ['credentialId', 'branch'], {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function txStore(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Version store
// ---------------------------------------------------------------------------

export class VersionStore {
  async listVersions(credentialId: string): Promise<VersionMetadata[]> {
    const db = await openDB();
    const store = txStore(db, 'readonly');
    const index = store.index('byCredential');
    const results = await requestToPromise<VersionMetadata[]>(
      index.getAll(IDBKeyRange.only(credentialId)),
    );
    return results.sort((a, b) => a.version - b.version);
  }

  async getVersion(
    credentialId: string,
    version: number,
  ): Promise<VersionMetadata | undefined> {
    const db = await openDB();
    const store = txStore(db, 'readonly');
    return requestToPromise<VersionMetadata | undefined>(
      store.get([credentialId, version]),
    );
  }

  async getLatestVersion(
    credentialId: string,
  ): Promise<VersionMetadata | undefined> {
    const versions = await this.listVersions(credentialId);
    return versions.length ? versions[versions.length - 1] : undefined;
  }

  async createVersion(input: CreateVersionInput): Promise<VersionMetadata> {
    const existing = await this.listVersions(input.credentialId);
    const nextVersion =
      existing.length === 0
        ? 1
        : Math.max(...existing.map((v) => v.version)) + 1;

    const parentVersion =
      input.parentVersion !== undefined
        ? input.parentVersion
        : existing.length
          ? existing[existing.length - 1].version
          : null;

    const meta: VersionMetadata = {
      credentialId: input.credentialId,
      version: nextVersion,
      timestamp: Date.now(),
      author: input.author ?? 'unknown',
      reason: input.reason ?? '',
      annotation: input.annotation,
      parentVersion,
      branch: input.branch ?? 'main',
      snapshot: deepClone(input.snapshot),
    };

    const db = await openDB();
    const store = txStore(db, 'readwrite');
    await requestToPromise(store.put(meta));
    return meta;
  }

  async updateAnnotation(
    credentialId: string,
    version: number,
    annotation: string,
  ): Promise<VersionMetadata | undefined> {
    const existing = await this.getVersion(credentialId, version);
    if (!existing) return undefined;
    const updated: VersionMetadata = { ...existing, annotation };
    const db = await openDB();
    const store = txStore(db, 'readwrite');
    await requestToPromise(store.put(updated));
    return updated;
  }

  async restoreVersion(
    credentialId: string,
    version: number,
    options: RestoreOptions = {},
  ): Promise<VersionMetadata> {
    const source = await this.getVersion(credentialId, version);
    if (!source) {
      throw new Error(
        `Version ${version} not found for credential ${credentialId}`,
      );
    }
    return this.createVersion({
      credentialId,
      snapshot: source.snapshot,
      author: options.author ?? 'unknown',
      reason: options.reason ?? `Restored from version ${version}`,
      annotation: options.annotation,
      parentVersion: version,
      branch: options.branch ?? source.branch,
    });
  }

  async createBranch(
    credentialId: string,
    fromVersion: number,
    branchName: string,
    options: RestoreOptions = {},
  ): Promise<VersionMetadata> {
    const source = await this.getVersion(credentialId, fromVersion);
    if (!source) {
      throw new Error(
        `Version ${fromVersion} not found for credential ${credentialId}`,
      );
    }
    return this.createVersion({
      credentialId,
      snapshot: source.snapshot,
      author: options.author ?? 'unknown',
      reason: options.reason ?? `Branched from version ${fromVersion}`,
      annotation: options.annotation,
      parentVersion: fromVersion,
      branch: branchName,
    });
  }

  async deleteVersion(credentialId: string, version: number): Promise<void> {
    const db = await openDB();
    const store = txStore(db, 'readwrite');
    await requestToPromise(store.delete([credentialId, version]));
  }
}

export const versionStore = new VersionStore();

// ---------------------------------------------------------------------------
// Diff utilities
// ---------------------------------------------------------------------------

const CLAIM_PREFIX = 'claim:';

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepClone(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isClaimKey(key: string): boolean {
  return key.startsWith(CLAIM_PREFIX);
}

export function computeDiff(
  from: VersionMetadata,
  to: VersionMetadata,
): VersionDiff {
  const fromSnap = from.snapshot ?? {};
  const toSnap = to.snapshot ?? {};
  const allKeys = new Set<string>([
    ...Object.keys(fromSnap),
    ...Object.keys(toSnap),
  ]);

  const fields: FieldDiff[] = [];
  const claims: ClaimDiff[] = [];

  for (const key of allKeys) {
    const hasFrom = Object.prototype.hasOwnProperty.call(fromSnap, key);
    const hasTo = Object.prototype.hasOwnProperty.call(toSnap, key);
    const fromVal = fromSnap[key];
    const toVal = toSnap[key];

    let type: FieldChangeType;
    if (!hasFrom && hasTo) type = 'added';
    else if (hasFrom && !hasTo) type = 'removed';
    else if (!isEqual(fromVal, toVal)) type = 'modified';
    else type = 'unchanged';

    if (isClaimKey(key)) {
      claims.push({
        claim: key.slice(CLAIM_PREFIX.length),
        type,
        from: fromVal,
        to: toVal,
      });
    } else {
      fields.push({
        field: key,
        type,
        from: fromVal,
        to: toVal,
      });
    }
  }

  fields.sort((a, b) => a.field.localeCompare(b.field));
  claims.sort((a, b) => a.claim.localeCompare(b.claim));

  const hasChanges =
    fields.some((f) => f.type !== 'unchanged') ||
    claims.some((c) => c.type !== 'unchanged');

  return {
    fromVersion: from.version,
    toVersion: to.version,
    fields,
    claims,
    hasChanges,
  };
}

export function getChangedFields(diff: VersionDiff): FieldDiff[] {
  return diff.fields.filter((f) => f.type !== 'unchanged');
}

export function getChangedClaims(diff: VersionDiff): ClaimDiff[] {
  return diff.claims.filter((c) => c.type !== 'unchanged');
}

// ---------------------------------------------------------------------------
// Undo / redo stack
// ---------------------------------------------------------------------------

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  push: (entry: UndoEntry) => void;
  clear: () => void;
}

export interface UndoEntry {
  credentialId: string;
  // Snapshot to restore when undoing
  undoSnapshot: CredentialSnapshot;
  // Snapshot to restore when redoing
  redoSnapshot: CredentialSnapshot;
  label?: string;
}

export function createUndoRedoStack(
  onApply: (credentialId: string, snapshot: CredentialSnapshot) => Promise<void>,
): UndoRedoState {
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((l) => l());

  return {
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    async undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      await onApply(entry.credentialId, entry.undoSnapshot);
      redoStack.push(entry);
      notify();
    },
    async redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      await onApply(entry.credentialId, entry.redoSnapshot);
      undoStack.push(entry);
      notify();
    },
    push(entry: UndoEntry) {
      undoStack.push(entry);
      redoStack.length = 0;
      notify();
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface UseVersionHistoryResult {
  versions: VersionMetadata[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  createVersion: (input: Omit<CreateVersionInput, 'credentialId'>) => Promise<VersionMetadata>;
  restoreVersion: (version: number, options?: RestoreOptions) => Promise<VersionMetadata>;
  createBranch: (
    fromVersion: number,
    branchName: string,
    options?: RestoreOptions,
  ) => Promise<VersionMetadata>;
  updateAnnotation: (version: number, annotation: string) => Promise<void>;
  undoRedo: UndoRedoState;
}

export function useVersionHistory(
  credentialId: string | null | undefined,
): UseVersionHistoryResult {
  const [versions, setVersions] = useState<VersionMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(!!credentialId);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!credentialId) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await versionStore.listVersions(credentialId);
      if (mountedRef.current) {
        setVersions(list);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [credentialId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const undoRedo = useMemo(
    () =>
      createUndoRedoStack(async (cid, snapshot) => {
        await versionStore.createVersion({
          credentialId: cid,
          snapshot,
          reason: 'Undo/redo',
        });
        await refresh();
      }),
    [refresh],
  );

  const createVersion = useCallback(
    async (input: Omit<CreateVersionInput, 'credentialId'>) => {
      if (!credentialId) {
        throw new Error('No credential selected');
      }
      const created = await versionStore.createVersion({
        ...input,
        credentialId,
      });
      await refresh();
      return created;
    },
    [credentialId, refresh],
  );

  const restoreVersion = useCallback(
    async (version: number, options?: RestoreOptions) => {
      if (!credentialId) {
        throw new Error('No credential selected');
      }
      const restored = await versionStore.restoreVersion(
        credentialId,
        version,
        options,
      );
      await refresh();
      return restored;
    },
    [credentialId, refresh],
  );

  const createBranch = useCallback(
    async (
      fromVersion: number,
      branchName: string,
      options?: RestoreOptions,
    ) => {
      if (!credentialId) {
        throw new Error('No credential selected');
      }
      const branched = await versionStore.createBranch(
        credentialId,
        fromVersion,
        branchName,
        options,
      );
      await refresh();
      return branched;
    },
    [credentialId, refresh],
  );

  const updateAnnotation = useCallback(
    async (version: number, annotation: string) => {
      if (!credentialId) {
        throw new Error('No credential selected');
      }
      await versionStore.updateAnnotation(credentialId, version, annotation);
      await refresh();
    },
    [credentialId, refresh],
  );

  return {
    versions,
    loading,
    error,
    refresh,
    createVersion,
    restoreVersion,
    createBranch,
    updateAnnotation,
    undoRedo,
  };
}

export interface UseVersionDiffResult {
  diff: VersionDiff | null;
  from: VersionMetadata | null;
  to: VersionMetadata | null;
  loading: boolean;
  error: Error | null;
}

export function useVersionDiff(
  fromId: VersionKey | null | undefined,
  toId: VersionKey | null | undefined,
): UseVersionDiffResult {
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [from, setFrom] = useState<VersionMetadata | null>(null);
  const [to, setTo] = useState<VersionMetadata | null>(null);
  const [loading, setLoading] = useState<boolean>(!!fromId && !!toId);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!fromId || !toId) {
        setDiff(null);
        setFrom(null);
        setTo(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [fromMeta, toMeta] = await Promise.all([
          versionStore.getVersion(fromId.credentialId, fromId.version),
          versionStore.getVersion(toId.credentialId, toId.version),
        ]);
        if (cancelled) return;
        if (!fromMeta || !toMeta) {
          setError(new Error('One or both versions not found'));
          setDiff(null);
          setFrom(fromMeta ?? null);
          setTo(toMeta ?? null);
        } else {
          setFrom(fromMeta);
          setTo(toMeta);
          setDiff(computeDiff(fromMeta, toMeta));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setDiff(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [fromId?.credentialId, fromId?.version, toId?.credentialId, toId?.version]);

  return { diff, from, to, loading, error };
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export { DB_NAME as VERSION_DB_NAME, STORE_NAME as VERSION_STORE_NAME };