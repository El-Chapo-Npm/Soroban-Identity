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

/**
 * Tracks active collaborators on a DID/credential over a WebSocket presence
 * protocol. Handles joins, updates, leaves, periodic syncs, stale peers and
 * graceful reconnection when the connection drops.
 */
export function usePresence({
  url,
  resourceId,
  currentUser,
  staleAfterMs = DEFAULT_STALE_MS,
  reconnectDelayMs = DEFAULT_RECONNECT_MS,
}: UsePresenceOptions): UsePresenceResult {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [status, setStatusState] = useState<PresenceStatus>('viewing');
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const statusRef = useRef<PresenceStatus>('viewing');

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
          ...currentUser,
          status: next,
          resourceId,
          lastSeen: Date.now(),
        },
      });
    },
    [currentUser, resourceId, send],
  );

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        send({
          type: 'presence:join',
          user: {
            ...currentUser,
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

        switch (message.type) {
          case 'presence:sync':
            if (message.users) {
              setUsers(message.users.filter((u) => u.id !== currentUser.id));
            }
            break;
          case 'presence:join':
          case 'presence:update':
            if (message.user && message.user.id !== currentUser.id) {
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
        setConnected(false);
        if (!closedRef.current) {
          reconnectRef.current = setTimeout(connect, reconnectDelayMs);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: 'presence:leave', userId: currentUser.id }),
        );
      }
      socket?.close();
      socketRef.current = null;
    };
  }, [url, resourceId, currentUser, reconnectDelayMs, send, upsertUser, removeUser]);

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
