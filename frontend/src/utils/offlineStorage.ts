/**
 * Offline storage utility using IndexedDB for DIDs, Credentials, and Write Sync Queue.
 */

import type { Credential, DidDocument } from '../../../sdk/src/types';

const DB_NAME = 'soroban-identity';
const DB_VERSION = 2;

export interface QueuedWriteOperation {
  id: string;
  type: 'issue_credential' | 'revoke_credential' | 'create_did' | 'update_did';
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  status: 'pending' | 'processing' | 'failed';
  lastError?: string;
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
