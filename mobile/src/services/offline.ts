import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

const PREFIX = 'soroban-id:cache:';
const QUEUE_KEY = 'soroban-id:queue';
const QUEUE_META_KEY = 'soroban-id:queue:meta';

export interface QueuedMutation {
  id: string;
  key: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
  // Optional base version for optimistic concurrency conflict resolution.
  baseVersion?: string;
}

export type ConflictStrategy = 'server-wins' | 'client-wins' | 'merge';

export interface QueueStatus {
  pending: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface OfflineState {
  online: boolean;
  queue: QueuedMutation[];
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Redux integration
// ---------------------------------------------------------------------------

export const OFFLINE_SET_ONLINE = 'offline/SET_ONLINE';
export const OFFLINE_SET_QUEUE = 'offline/SET_QUEUE';
export const OFFLINE_SET_SYNCING = 'offline/SET_SYNCING';
export const OFFLINE_SET_SYNC_RESULT = 'offline/SET_SYNC_RESULT';
export const OFFLINE_SET_ERROR = 'offline/SET_ERROR';

export const setOnline = (online: boolean) => ({ type: OFFLINE_SET_ONLINE, payload: online });
export const setQueue = (queue: QueuedMutation[]) => ({ type: OFFLINE_SET_QUEUE, payload: queue });
export const setSyncing = (syncing: boolean) => ({ type: OFFLINE_SET_SYNCING, payload: syncing });
export const setSyncResult = (lastSyncedAt: number | null) => ({
  type: OFFLINE_SET_SYNC_RESULT,
  payload: lastSyncedAt,
});
export const setError = (error: string | null) => ({ type: OFFLINE_SET_ERROR, payload: error });

const initialState: OfflineState = {
  online: true,
  queue: [],
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
};

export function offlineReducer(
  state: OfflineState = initialState,
  action: { type: string; payload?: unknown },
): OfflineState {
  switch (action.type) {
    case OFFLINE_SET_ONLINE:
      return { ...state, online: Boolean(action.payload) };
    case OFFLINE_SET_QUEUE:
      return { ...state, queue: (action.payload as QueuedMutation[]) ?? [] };
    case OFFLINE_SET_SYNCING:
      return { ...state, syncing: Boolean(action.payload) };
    case OFFLINE_SET_SYNC_RESULT:
      return { ...state, lastSyncedAt: (action.payload as number | null) ?? null };
    case OFFLINE_SET_ERROR:
      return { ...state, lastError: (action.payload as string | null) ?? null };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

export function useOnline() {
  const dispatch = useDispatch();
  const [online, setLocalOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        const isOnline = Boolean(s.isConnected);
        setLocalOnline(isOnline);
        dispatch(setOnline(isOnline));
      }),
    [dispatch],
  );
  return online;
}

// ---------------------------------------------------------------------------
// Cache (network-first with offline fallback)
// ---------------------------------------------------------------------------

// Network-first read that falls back to the last cached value when offline or on failure.
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T | null; stale: boolean }> {
  const { isConnected } = await NetInfo.fetch();
  if (isConnected) {
    try {
      const data = await fetcher();
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(data));
      return { data, stale: false };
    } catch {
      /* fall through to cache */
    }
  }
  const raw = await AsyncStorage.getItem(PREFIX + key);
  return { data: raw ? (JSON.parse(raw) as T) : null, stale: true };
}

export async function invalidateCache(key: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + key);
}

// ---------------------------------------------------------------------------
// Write queue
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedMutation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedMutation[]> {
  return readQueue();
}

export async function enqueue(
  mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'attempts'>,
): Promise<QueuedMutation> {
  const queue = await readQueue();
  const entry: QueuedMutation = {
    ...mutation,
    id: generateId(),
    createdAt: Date.now(),
    attempts: 0,
  };
  queue.push(entry);
  await writeQueue(queue);
  return entry;
}

export async function dequeue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((m) => m.id !== id));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export interface ConflictContext {
  local: QueuedMutation;
  server: unknown;
  strategy: ConflictStrategy;
}

// Resolves a 409 conflict. Returns the body to retry with, or null to drop the mutation.
export function resolveConflict({ local, server, strategy }: ConflictContext): unknown | null {
  switch (strategy) {
    case 'server-wins':
      return null;
    case 'client-wins':
      return local.body;
    case 'merge': {
      if (
        server &&
        typeof server === 'object' &&
        local.body &&
        typeof local.body === 'object'
      ) {
        return { ...(server as Record<string, unknown>), ...(local.body as Record<string, unknown>) };
      }
      return local.body ?? server;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Background sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  // Executes a single mutation against the backend. Should throw on failure.
  executor: (mutation: QueuedMutation) => Promise<{ status: number; data?: unknown }>;
  conflictStrategy?: ConflictStrategy;
  maxAttempts?: number;
  onProgress?: (queue: QueuedMutation[]) => void;
}

export interface SyncResult {
  synced: number;
  failed: number;
  dropped: number;
  lastSyncedAt: number | null;
}

let syncing = false;

export async function syncQueue(options: SyncOptions): Promise<SyncResult> {
  const { executor, conflictStrategy = 'server-wins', maxAttempts = 5, onProgress } = options;
  const result: SyncResult = { synced: 0, failed: 0, dropped: 0, lastSyncedAt: null };

  if (syncing) return result;
  syncing = true;

  try {
    const { isConnected } = await NetInfo.fetch();
    if (!isConnected) return result;

    let queue = await readQueue();
    const remaining: QueuedMutation[] = [];

    for (const mutation of queue) {
      try {
        const response = await executor(mutation);
        if (response.status >= 200 && response.status < 300) {
          result.synced += 1;
          continue;
        }
        if (response.status === 409) {
          const resolved = resolveConflict({
            local: mutation,
            server: response.data,
            strategy: conflictStrategy,
          });
          if (resolved === null) {
            result.dropped += 1;
            continue;
          }
          const retry = await executor({ ...mutation, body: resolved });
          if (retry.status >= 200 && retry.status < 300) {
            result.synced += 1;
            continue;
          }
        }
        throw new Error(`Unexpected status ${response.status}`);
      } catch (err) {
        const attempts = mutation.attempts + 1;
        if (attempts >= maxAttempts) {
          result.dropped += 1;
          continue;
        }
        result.failed += 1;
        remaining.push({
          ...mutation,
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    queue = remaining;
    await writeQueue(queue);
    onProgress?.(queue);

    if (result.synced > 0) {
      result.lastSyncedAt = Date.now();
      await AsyncStorage.setItem(QUEUE_META_KEY, JSON.stringify({ lastSyncedAt: result.lastSyncedAt }));
    }
    return result;
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useQueueStatus(): QueueStatus {
  const queue = useSelector((s: { offline: OfflineState }) => s.offline.queue);
  const isSyncing = useSelector((s: { offline: OfflineState }) => s.offline.syncing);
  const lastSyncedAt = useSelector((s: { offline: OfflineState }) => s.offline.lastSyncedAt);
  const lastError = useSelector((s: { offline: OfflineState }) => s.offline.lastError);
  return { pending: queue.length, syncing: isSyncing, lastSyncedAt, lastError };
}

// Keeps Redux in sync with the persisted queue and triggers background sync on reconnect.
export function useOfflineSync(options: SyncOptions) {
  const dispatch = useDispatch();
  const online = useOnline();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const queue = await readQueue();
      if (mounted) dispatch(setQueue(queue));
    })();
    return () => {
      mounted = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    (async () => {
      dispatch(setSyncing(true));
      dispatch(setError(null));
      try {
        const result = await syncQueue({
          ...options,
          onProgress: (queue) => {
            dispatch(setQueue(queue));
            options.onProgress?.(queue);
          },
        });
        if (cancelled) return;
        dispatch(setSyncResult(result.lastSyncedAt));
        const queue = await readQueue();
        dispatch(setQueue(queue));
      } catch (err) {
        if (!cancelled) dispatch(setError(err instanceof Error ? err.message : String(err)));
      } finally {
        if (!cancelled) dispatch(setSyncing(false));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, dispatch]);
}