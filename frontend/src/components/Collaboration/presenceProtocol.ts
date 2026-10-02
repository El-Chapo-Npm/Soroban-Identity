/**
 * Presence protocol for real-time collaboration indicators (FE-14).
 *
 * Defines the wire messages exchanged over the collaboration WebSocket and a
 * small, framework-agnostic client that tracks active users, edit locks and
 * connection state. UI components subscribe to snapshots to render avatars and
 * lock warnings.
 */

export type PresenceStatus = 'viewing' | 'editing';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface Collaborator {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  status: PresenceStatus;
  /** Resource (DID or credential id) the user is focused on. */
  resourceId: string;
  /** Monotonic timestamp (ms) of the last update, used for staleness. */
  updatedAt: number;
}

export interface EditLock {
  resourceId: string;
  userId: string;
  displayName: string;
  acquiredAt: number;
}

export interface PresenceSnapshot {
  connection: ConnectionState;
  collaborators: Collaborator[];
  locks: EditLock[];
}

/** Messages sent by the client to the presence server. */
export type PresenceClientMessage =
  | { type: 'join'; userId: string; displayName: string; avatarUrl?: string; resourceId: string }
  | { type: 'focus'; resourceId: string; status: PresenceStatus }
  | { type: 'lock'; resourceId: string }
  | { type: 'unlock'; resourceId: string }
  | { type: 'leave' }
  | { type: 'heartbeat'; at: number };

/** Messages broadcast by the presence server. */
export type PresenceServerMessage =
  | { type: 'presence'; collaborators: Collaborator[] }
  | { type: 'locks'; locks: EditLock[] }
  | { type: 'lock-denied'; resourceId: string; heldBy: EditLock }
  | { type: 'error'; message: string };

/** How long without an update before a collaborator is considered stale. */
export const PRESENCE_STALE_MS = 30_000;

/** Interval between client heartbeats. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

export interface PresenceClientOptions {
  url: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** Injectable for tests; defaults to the global WebSocket. */
  socketFactory?: (url: string) => WebSocket;
  /** Injectable clock for deterministic staleness handling. */
  now?: () => number;
}

type Listener = (snapshot: PresenceSnapshot) => void;

/**
 * Tracks collaborators and edit locks for a single collaboration session.
 * Handles reconnects and drops gracefully by clearing remote state and
 * surfacing a `disconnected` connection state to subscribers.
 */
export class PresenceClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly socketFactory: (url: string) => WebSocket;
  private collaborators = new Map<string, Collaborator>();
  private locks = new Map<string, EditLock>();
  private connection: ConnectionState = 'disconnected';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private currentResourceId: string | null = null;

  constructor(private readonly options: PresenceClientOptions) {
    this.now = options.now ?? (() => Date.now());
    this.socketFactory =
      options.socketFactory ?? ((url: string) => new WebSocket(url));
  }

  /** Subscribe to presence snapshots. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PresenceSnapshot {
    return {
      connection: this.connection,
      collaborators: Array.from(this.collaborators.values()),
      locks: Array.from(this.locks.values()),
    };
  }

  connect(): void {
    if (this.socket || this.closed) {
      return;
    }
    this.setConnection('connecting');
    const socket = this.socketFactory(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.setConnection('connected');
      this.send({
        type: 'join',
        userId: this.options.userId,
        displayName: this.options.displayName,
        avatarUrl: this.options.avatarUrl,
        resourceId: this.currentResourceId ?? '',
      });
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    socket.onclose = () => {
      this.handleDrop();
    };

    socket.onerror = () => {
      this.handleDrop();
    };
  }

  /** Notify the server which resource this client is focused on. */
  focus(resourceId: string, status: PresenceStatus = 'viewing'): void {
    this.currentResourceId = resourceId;
    this.send({ type: 'focus', resourceId, status });
  }

  /** Request an edit lock for a resource. */
  requestLock(resourceId: string): void {
    this.send({ type: 'lock', resourceId });
  }

  /** Release a previously acquired edit lock. */
  releaseLock(resourceId: string): void {
    this.send({ type: 'unlock', resourceId });
  }

  /** Whether another user currently holds the edit lock for a resource. */
  isLockedByOther(resourceId: string): EditLock | null {
    const lock = this.locks.get(resourceId);
    if (!lock || lock.userId === this.options.userId) {
      return null;
    }
    return lock;
  }

  disconnect(): void {
    this.closed = true;
    this.send({ type: 'leave' });
    this.teardownSocket();
    this.setConnection('disconnected');
  }

  private handleMessage(raw: unknown): void {
    let message: PresenceServerMessage;
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : (raw as PresenceServerMessage);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }

    switch (message.type) {
      case 'presence':
        this.applyPresence(message.collaborators);
        break;
      case 'locks':
        this.applyLocks(message.locks);
        break;
      case 'lock-denied':
        // Surface the holder so the UI can warn the user.
        this.locks.set(message.heldBy.resourceId, message.heldBy);
        this.emit();
        break;
      case 'error':
        break;
      default:
        break;
    }
  }

  private applyPresence(collaborators: Collaborator[]): void {
    const now = this.now();
    const next = new Map<string, Collaborator>();
    for (const collaborator of collaborators) {
      if (now - collaborator.updatedAt > PRESENCE_STALE_MS) {
        continue;
      }
      next.set(collaborator.userId, collaborator);
    }
    this.collaborators = next;
    this.emit();
  }

  private applyLocks(locks: EditLock[]): void {
    const next = new Map<string, EditLock>();
    for (const lock of locks) {
      next.set(lock.resourceId, lock);
    }
    this.locks = next;
    this.emit();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', at: this.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleDrop(): void {
    this.teardownSocket();
    // Clear remote state so stale avatars/locks are not shown after a drop.
    this.collaborators = new Map();
    this.locks = new Map();
    this.setConnection('disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3_000);
  }

  private teardownSocket(): void {
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Ignore close errors on an already-closed socket.
      }
    }
  }

  private send(message: PresenceClientMessage): void {
    if (!this.socket || this.socket.readyState !== 1 /* OPEN */) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // Ignore send failures; the drop handler will reconcile state.
    }
  }

  private setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
