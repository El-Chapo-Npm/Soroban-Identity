/**
 * Offline storage utility using IndexedDB for DIDs, Credentials, and Write Sync Queue.
 */

import type { Credential, DidDocument } from '../../../sdk/src/types';

const DB_NAME = 'soroban-identity';
const DB_VERSION = 3;

export interface QueuedWriteOperation {
  id: string;
  type: 'issue_credential' | 'revoke_credential' | 'create_did' | 'update_did';
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  status: 'pending' | 'processing' | 'failed';
  lastError?: string;
}

export interface CachedCredentialVersion {
  id: string;
  credentialId: string;
  version: number;
  credential: Credential;
  createdAt: number;
  note?: string;
  parentVersionId?: string | null;
  branch?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('pending-operations')) {
        db.createObjectStore('pending-operations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('credentials')) {
        db.createObjectStore('credentials', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dids')) {
        db.createObjectStore('dids', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('credential-versions')) {
        const versionStore = db.createObjectStore('credential-versions', { keyPath: 'id' });
        versionStore.createIndex('credentialId', 'credentialId', { unique: false });
      }
    };
  });
}

// ── DID Document Offline Cache ──────────────────────────────────────────────

export async function cacheDidDocument(did: DidDocument): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['dids'], 'readwrite');
    const store = tx.objectStore('dids');
    const req = store.put(did);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedDidDocument(id: string): Promise<DidDocument | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['dids'], 'readonly');
    const store = tx.objectStore('dids');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCachedDids(): Promise<DidDocument[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['dids'], 'readonly');
    const store = tx.objectStore('dids');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── Credential Offline Cache ────────────────────────────────────────────────

export async function cacheCredential(credential: Credential): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credentials'], 'readwrite');
    const store = tx.objectStore('credentials');
    const req = store.put(credential);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function cacheCredentials(credentials: Credential[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credentials'], 'readwrite');
    const store = tx.objectStore('credentials');
    for (const cred of credentials) {
      store.put(cred);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedCredential(id: string): Promise<Credential | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credentials'], 'readonly');
    const store = tx.objectStore('credentials');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCachedCredentials(): Promise<Credential[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credentials'], 'readonly');
    const store = tx.objectStore('credentials');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── Credential Version History ──────────────────────────────────────────────

export async function cacheCredentialVersion(version: CachedCredentialVersion): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credential-versions'], 'readwrite');
    const store = tx.objectStore('credential-versions');
    const req = store.put(version);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCredentialVersions(credentialId: string): Promise<CachedCredentialVersion[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credential-versions'], 'readonly');
    const store = tx.objectStore('credential-versions');
    const index = store.index('credentialId');
    const req = index.getAll(credentialId);
    req.onsuccess = () => {
      const versions: CachedCredentialVersion[] = req.result || [];
      versions.sort((a, b) => a.version - b.version);
      resolve(versions);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCredentialVersion(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['credential-versions'], 'readwrite');
    const store = tx.objectStore('credential-versions');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Write Operations Sync Queue ─────────────────────────────────────────────

export async function queueWriteOperation(
  type: QueuedWriteOperation['type'],
  payload: Record<string, unknown>
): Promise<QueuedWriteOperation> {
  const db = await openDatabase();
  const op: QueuedWriteOperation = {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
    status: 'pending',
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readwrite');
    const store = tx.objectStore('pending-operations');
    const req = store.put(op);
    req.onsuccess = () => resolve(op);
    req.onerror = () => reject(req.error);
  });
}

export async function getQueuedOperations(): Promise<QueuedWriteOperation[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readonly');
    const store = tx.objectStore('pending-operations');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedOperation(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readwrite');
    const store = tx.objectStore('pending-operations');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function updateQueuedOperation(op: QueuedWriteOperation): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readwrite');
    const store = tx.objectStore('pending-operations');
    const req = store.put(op);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Dashboard Layout Preferences ────────────────────────────────────────────

export interface DashboardWidgetLayout {
  /** Unique widget instance id (e.g. "credentials-overview"). */
  i: string;
  /** Widget type key from the widget library. */
  widgetType: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Per-widget configuration set via the configuration dialog. */
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  /** User address the layout belongs to. */
  address: string;
  /** Breakpoint key (e.g. "lg", "md", "sm") mapped to widget layouts. */
  breakpoints: Record<string, DashboardWidgetLayout[]>;
  /** Optional preset id the layout was derived from. */
  presetId?: string;
  updatedAt: number;
}

function layoutStorageKey(address: string): string {
  return `${DASHBOARD_LAYOUT_STORAGE_PREFIX}${address}`;
}

function isValidDashboardLayout(value: unknown): value is DashboardLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<DashboardLayout>;
  return (
    typeof layout.address === 'string' &&
    typeof layout.breakpoints === 'object' &&
    layout.breakpoints !== null &&
    typeof layout.updatedAt === 'number'
  );
}

/**
 * Read the dashboard layout from localStorage (synchronous fast path).
 * Returns null when nothing is stored or the stored value is malformed.
 */
export function getDashboardLayoutFromLocalStorage(address: string): DashboardLayout | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(layoutStorageKey(address));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidDashboardLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the dashboard layout to localStorage (synchronous fast path).
 */
export function setDashboardLayoutInLocalStorage(layout: DashboardLayout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(layoutStorageKey(layout.address), JSON.stringify(layout));
  } catch {
    // Storage may be full or unavailable (private mode); IndexedDB remains the fallback.
  }
}

/**
 * Remove the dashboard layout from localStorage.
 */
export function removeDashboardLayoutFromLocalStorage(address: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(layoutStorageKey(address));
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Persist the dashboard layout to IndexedDB and mirror it to localStorage.
 */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<DashboardLayout> {
  const record: DashboardLayout = { ...layout, updatedAt: Date.now() };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['dashboard-layouts'], 'readwrite');
    const store = tx.objectStore('dashboard-layouts');
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  setDashboardLayoutInLocalStorage(record);
  return record;
}

/**
 * Load the dashboard layout for an address. Prefers localStorage, falling
 * back to IndexedDB (and re-hydrating localStorage when found there).
 */
export async function getDashboardLayout(address: string): Promise<DashboardLayout | null> {
  const local = getDashboardLayoutFromLocalStorage(address);
  if (local) return local;

  const db = await openDatabase();
  const stored = await new Promise<DashboardLayout | null>((resolve, reject) => {
    const tx = db.transaction(['dashboard-layouts'], 'readonly');
    const store = tx.objectStore('dashboard-layouts');
    const req = store.get(address);
    req.onsuccess = () => {
      const result: unknown = req.result;
      resolve(isValidDashboardLayout(result) ? result : null);
    };
    req.onerror = () => reject(req.error);
  });

  if (stored) setDashboardLayoutInLocalStorage(stored);
  return stored;
}

/**
 * Reset the dashboard layout for an address, removing it from both
 * localStorage and IndexedDB so the default layout applies again.
 */
export async function resetDashboardLayout(address: string): Promise<void> {
  removeDashboardLayoutFromLocalStorage(address);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['dashboard-layouts'], 'readwrite');
    const store = tx.objectStore('dashboard-layouts');
    const req = store.delete(address);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Sync the dashboard layout to the backend. The layout is always persisted
 * locally first; if the network request fails it is queued for later sync.
 */
export async function syncDashboardLayoutToBackend(
  layout: DashboardLayout,
  apiBaseUrl: string
): Promise<{ synced: boolean; queued: boolean }> {
  const record = await saveDashboardLayout(layout);

  try {
    const response = await fetch(
      `${apiBaseUrl}/users/${encodeURIComponent(record.address)}/dashboard-layout`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }
    );
    if (!response.ok) throw new Error(`Layout sync failed with status ${response.status}`);
    return { synced: true, queued: false };
  } catch {
    await queueWriteOperation('update_did', {
      kind: 'dashboard_layout',
      address: record.address,
      layout: record as unknown as Record<string, unknown>,
    });
    return { synced: false, queued: true };
  }
}

/**
 * Fetch the dashboard layout from the backend and cache it locally.
 * Returns null when the backend has no layout for the address.
 */
export async function fetchDashboardLayoutFromBackend(
  address: string,
  apiBaseUrl: string
): Promise<DashboardLayout | null> {
  const response = await fetch(
    `${apiBaseUrl}/users/${encodeURIComponent(address)}/dashboard-layout`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Layout fetch failed with status ${response.status}`);

  const data: unknown = await response.json();
  if (!isValidDashboardLayout(data)) return null;

  await saveDashboardLayout(data);
  return data;
}
