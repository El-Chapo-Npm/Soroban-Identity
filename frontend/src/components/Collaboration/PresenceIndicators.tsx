import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PresenceStatus = 'viewing' | 'editing' | 'idle';

export interface Collaborator {
  id: string;
  name: string;
  avatarUrl?: string;
  status: PresenceStatus;
  targetId: string;
  targetType: 'did' | 'credential';
  lastSeen: number;
}

export interface PresenceIndicatorsProps {
  /** WebSocket endpoint for the presence protocol. */
  wsUrl: string;
  /** DID or credential currently open in this client. */
  targetId: string;
  targetType: 'did' | 'credential';
  /** Identity of the local user, used to filter self out of the list. */
  currentUserId: string;
  /** Optional callback fired when a remote edit lock is acquired/released. */
  onLockChange?: (lockedBy: Collaborator | null) => void;
}

interface PresenceMessage {
  type: 'presence:sync' | 'presence:join' | 'presence:update' | 'presence:leave' | 'presence:lock';
  payload?: unknown;
}

const STALE_AFTER_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

function isCollaborator(value: unknown): value is Collaborator {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Collaborator>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.targetId === 'string' &&
    (c.targetType === 'did' || c.targetType === 'credential') &&
    (c.status === 'viewing' || c.status === 'editing' || c.status === 'idle')
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Real-time collaboration indicators for a DID or credential.
 *
 * Tracks active users over a WebSocket presence protocol, renders avatars for
 * everyone currently viewing/editing the same target, surfaces edit locks, and
 * degrades gracefully when the connection drops.
 */
export const PresenceIndicators: React.FC<PresenceIndicatorsProps> = ({
  wsUrl,
  targetId,
  targetType,
  currentUserId,
  onLockChange,
}) => {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUnmountRef = useRef(false);

  const upsertCollaborator = useCallback((incoming: Collaborator) => {
    setCollaborators((prev) => {
      const next = prev.filter((c) => c.id !== incoming.id);
      next.push({ ...incoming, lastSeen: Date.now() });
      return next;
    });
  }, []);

  const removeCollaborator = useCallback((id: string) => {
    setCollaborators((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const send = useCallback((message: PresenceMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const connect = useCallback(() => {
    if (closedByUnmountRef.current) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      // Malformed URL or blocked transport: retry with backoff.
      scheduleReconnect();
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnected(true);
      send({
        type: 'presence:join',
        payload: { id: currentUserId, targetId, targetType },
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
        case 'presence:sync': {
          const list = Array.isArray(message.payload) ? message.payload : [];
          const valid = list.filter(isCollaborator).filter((c) => c.id !== currentUserId);
          setCollaborators(valid.map((c) => ({ ...c, lastSeen: Date.now() })));
          break;
        }
        case 'presence:join':
        case 'presence:update': {
          if (isCollaborator(message.payload) && message.payload.id !== currentUserId) {
            upsertCollaborator(message.payload);
          }
          break;
        }
        case 'presence:leave': {
          const payload = message.payload as { id?: string } | undefined;
          if (payload?.id) removeCollaborator(payload.id);
          break;
        }
        case 'presence:lock': {
          if (isCollaborator(message.payload) && message.payload.id !== currentUserId) {
            upsertCollaborator(message.payload);
          }
          break;
        }
        default:
          break;
      }
    };

    socket.onclose = () => {
      setConnected(false);
      socketRef.current = null;
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose fires afterwards and drives the reconnect loop.
      socket.close();
    };
  }, [wsUrl, currentUserId, targetId, targetType, send, upsertCollaborator, removeCollaborator]);

  const scheduleReconnect = useCallback(() => {
    if (closedByUnmountRef.current || reconnectTimerRef.current) return;
    const attempt = reconnectAttemptsRef.current++;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    closedByUnmountRef.current = false;
    connect();
    return () => {
      closedByUnmountRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: 'presence:leave', payload: { id: currentUserId } }),
        );
      }
      socket?.close();
      socketRef.current = null;
    };
  }, [connect, currentUserId]);

  // Drop collaborators that have gone silent (e.g. abrupt disconnect).
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - STALE_AFTER_MS;
      setCollaborators((prev) => prev.filter((c) => c.lastSeen >= cutoff));
    }, STALE_AFTER_MS / 2);
    return () => clearInterval(interval);
  }, []);

  const activeEditor = useMemo(
    () => collaborators.find((c) => c.status === 'editing') ?? null,
    [collaborators],
  );

  useEffect(() => {
    onLockChange?.(activeEditor);
  }, [activeEditor, onLockChange]);

  const viewers = collaborators.filter((c) => c.status !== 'editing');

  return (
    <div className="collaboration-presence" aria-live="polite">
      <div className="collaboration-presence__avatars">
        {collaborators.length === 0 && (
          <span className="collaboration-presence__empty">No one else is here</span>
        )}
        {collaborators.map((c) => (
          <span
            key={c.id}
            className={`collaboration-presence__avatar collaboration-presence__avatar--${c.status}`}
            title={`${c.name} is ${c.status}`}
          >
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt={c.name} />
            ) : (
              <span aria-hidden="true">{initials(c.name)}</span>
            )}
            <span className="collaboration-presence__sr-only">
              {c.name} is {c.status}
            </span>
          </span>
        ))}
      </div>

      {activeEditor && (
        <div className="collaboration-presence__lock" role="alert">
          {activeEditor.name} is editing this {targetType}. Your changes may conflict.
        </div>
      )}

      {!activeEditor && viewers.length > 0 && (
        <div className="collaboration-presence__viewers">
          {viewers.length} {viewers.length === 1 ? 'person' : 'people'} viewing
        </div>
      )}

      {!connected && (
        <div className="collaboration-presence__offline" role="status">
          Reconnecting… presence may be out of date.
        </div>
      )}
    </div>
  );
};

export default PresenceIndicators;
