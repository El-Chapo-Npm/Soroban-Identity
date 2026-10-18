import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PresenceStatus = 'viewing' | 'editing';

export interface PresenceUser {
  id: string;
  name: string;
  avatarUrl?: string;
  status: PresenceStatus;
  resourceId: string;
  lastSeen: number;
}

export interface PresenceMessage {
  type: 'presence:join' | 'presence:update' | 'presence:leave' | 'presence:sync';
  user?: PresenceUser;
  users?: PresenceUser[];
  userId?: string;
}

export interface UsePresenceOptions {
  /** WebSocket endpoint for the presence protocol. */
  url: string;
  /** DID or credential currently being viewed/edited. */
  resourceId: string;
  /** Identity of the local user. */
  currentUser: Omit<PresenceUser, 'status' | 'resourceId' | 'lastSeen'>;
  /** Milliseconds before a silent peer is considered stale. */
  staleAfterMs?: number;
  /** Milliseconds between reconnect attempts. */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts before stopping automatic retries (#1068). */
  maxReconnectAttempts?: number;
}

export interface UsePresenceResult {
  users: PresenceUser[];
  /** Users other than the local user currently editing the resource. */
  editors: PresenceUser[];
  /** True when someone else holds the edit lock. */
  isLocked: boolean;
  /** Human-readable warning when the resource is locked. */
  lockWarning: string | null;
  status: PresenceStatus;
  connected: boolean;
  setStatus: (status: PresenceStatus) => void;
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RECONNECT_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Tracks active collaborators on a DID/credential over a WebSocket presence
 * protocol. Handles joins, updates, leaves, periodic syncs, stale peers and
 * graceful reconnection when the connection drops or the device switches
 * networks (#1068).
 */
export function usePresence({
  url,
  resourceId,
  currentUser,
  staleAfterMs = DEFAULT_STALE_MS,
  reconnectDelayMs = DEFAULT_RECONNECT_MS,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
}: UsePresenceOptions): UsePresenceResult {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [status, setStatusState] = useState<PresenceStatus>('viewing');
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const offlineRef = useRef(false);
  const closedRef = useRef(false);
  const statusRef = useRef<PresenceStatus>('viewing');
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const send = useCallback((message: PresenceMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const upsertUser = useCallback((incoming: PresenceUser) => {
    setUsers((prev) => {
      const next = prev.filter((u) => u.id !== incoming.id);
      next.push(incoming);
      return next;
    });
  }, []);

  const removeUser = useCallback((userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  }, []);

  const setStatus = useCallback(
    (next: PresenceStatus) => {
      statusRef.current = next;
      setStatusState(next);
      send({
        type: 'presence:update',
        user: {
          ...currentUserRef.current,
          status: next,
          resourceId,
          lastSeen: Date.now(),
        },
      });
    },
    [resourceId, send],
  );

  useEffect(() => {
    closedRef.current = false;
    reconnectAttemptsRef.current = 0;

    const clearReconnectTimer = () => {
      if (reconnectRef.current !== null) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    const teardownSocket = () => {
      const existing = socketRef.current;
      socketRef.current = null;
      if (existing) {
        existing.onopen = null;
        existing.onmessage = null;
        existing.onclose = null;
        existing.onerror = null;
        try {
          existing.close();
        } catch {
          // Ignore close errors on an already-closed socket.
        }
      }
    };

    const scheduleReconnect = () => {
      if (
        closedRef.current ||
        offlineRef.current ||
        reconnectRef.current !== null ||
        reconnectAttemptsRef.current >= maxReconnectAttempts
      ) {
        return;
      }
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        reconnectDelayMs * 2 ** (reconnectAttemptsRef.current - 1),
      );
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (closedRef.current || offlineRef.current || socketRef.current) return;
      clearReconnectTimer();
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        send({
          type: 'presence:join',
          user: {
            ...currentUserRef.current,
            status: statusRef.current,
            resourceId,
            lastSeen: Date.now(),
          },
        });
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: PresenceMessage;
        try {
          message = JSON.parse(event.data) as PresenceMessage;
        } catch {
          return;
        }

        const localUserId = currentUserRef.current.id;
        switch (message.type) {
          case 'presence:sync':
            if (message.users) {
              setUsers(message.users.filter((u) => u.id !== localUserId));
            }
            break;
          case 'presence:join':
          case 'presence:update':
            if (message.user && message.user.id !== localUserId) {
              upsertUser(message.user);
            }
            break;
          case 'presence:leave':
            if (message.userId) removeUser(message.userId);
            break;
          default:
            break;
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        setConnected(false);
        scheduleReconnect();
      };

      socket.onerror = () => {
        teardownSocket();
        setConnected(false);
        scheduleReconnect();
      };
    };

    const handleOnline = () => {
      if (closedRef.current) return;
      offlineRef.current = false;
      reconnectAttemptsRef.current = 0;
      clearReconnectTimer();
      teardownSocket();
      setConnected(false);
      connect();
    };

    const handleOffline = () => {
      if (closedRef.current) return;
      offlineRef.current = true;
      clearReconnectTimer();
      teardownSocket();
      setConnected(false);
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    connect();

    return () => {
      closedRef.current = true;
      clearReconnectTimer();
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: 'presence:leave', userId: currentUserRef.current.id }),
        );
      }
      teardownSocket();
    };
  }, [url, resourceId, reconnectDelayMs, maxReconnectAttempts, send, upsertUser, removeUser]);

  // Drop peers that stopped sending heartbeats.
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - staleAfterMs;
      setUsers((prev) => prev.filter((u) => u.lastSeen >= cutoff));
    }, staleAfterMs);
    return () => clearInterval(interval);
  }, [staleAfterMs]);

  const editors = useMemo(
    () => users.filter((u) => u.status === 'editing'),
    [users],
  );

  const isLocked = editors.length > 0;
  const lockWarning = isLocked
    ? `${editors.map((u) => u.name).join(', ')} ${editors.length === 1 ? 'is' : 'are'} editing this resource.`
    : null;

  return { users, editors, isLocked, lockWarning, status, connected, setStatus };
}

export default usePresence;
