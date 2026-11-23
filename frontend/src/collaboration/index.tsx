import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type Role = 'viewer' | 'editor' | 'admin';

export interface CollaboratorUser {
  id: string;
  name: string;
  color: string;
  role: Role;
}

export interface PresenceState {
  user: CollaboratorUser;
  cursor?: {
    field: string;
    index: number;
    selectionEnd?: number;
  } | null;
  lastSeen: number;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  mentions: string[];
  createdAt: number;
  resolved: boolean;
  field?: string;
}

export interface ActivityItem {
  id: string;
  userId: string;
  userName: string;
  action: string;
  detail?: string;
  timestamp: number;
}

export interface MentionNotification {
  mentionedUserId: string;
  comment: Comment;
  byUserId: string;
}

export interface CollaborationConfig {
  /** WebSocket server URL, e.g. wss://collab.example.com */
  serverUrl: string;
  /** Room / document identifier */
  room: string;
  /** Current user */
  user: CollaboratorUser;
  /** Optional auth token passed to the websocket provider */
  token?: string;
  /** Optional Yjs document to seed (for tests / SSR) */
  doc?: Y.Doc;
  /** Callback when the current user is @mentioned */
  onMention?: (notification: MentionNotification) => void;
  /** Callback for activity feed updates */
  onActivity?: (item: ActivityItem) => void;
}

/* -------------------------------------------------------------------------- */
/*                              Permission model                              */
/* -------------------------------------------------------------------------- */

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export interface PermissionSet {
  role: Role;
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  canResolveComment: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
  /** Check whether the current role satisfies a minimum role */
  atLeast: (min: Role) => boolean;
}

export function buildPermissions(role: Role): PermissionSet {
  const rank = ROLE_RANK[role] ?? 0;
  return {
    role,
    canView: rank >= ROLE_RANK.viewer,
    canEdit: rank >= ROLE_RANK.editor,
    canComment: rank >= ROLE_RANK.editor,
    canResolveComment: rank >= ROLE_RANK.editor,
    canManageRoles: rank >= ROLE_RANK.admin,
    canDelete: rank >= ROLE_RANK.admin,
    atLeast: (min: Role) => rank >= (ROLE_RANK[min] ?? Infinity),
  };
}

/* -------------------------------------------------------------------------- */
/*                              Mention parsing                               */
/* -------------------------------------------------------------------------- */

const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)|@([A-Za-z0-9_.\-]+)/g;

export function parseMentions(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    if (match[2]) {
      found.add(match[2]);
    } else if (match[3]) {
      found.add(match[3]);
    }
  }
  return Array.from(found);
}

/* -------------------------------------------------------------------------- */
/*                              Collaboration core                            */
/* -------------------------------------------------------------------------- */

const FIELDS_MAP = 'fields';
const COMMENTS_ARRAY = 'comments';
const ACTIVITY_ARRAY = 'activity';

interface CollaborationCore {
  doc: Y.Doc;
  provider: WebsocketProvider | null;
  fields: Y.Map<string>;
  comments: Y.Array<Comment>;
  activity: Y.Array<ActivityItem>;
  user: CollaboratorUser;
  connected: boolean;
  destroy: () => void;
}

function createCore(config: CollaborationConfig): CollaborationCore {
  const doc = config.doc ?? new Y.Doc();
  const fields = doc.getMap<string>(FIELDS_MAP);
  const comments = doc.getArray<Comment>(COMMENTS_ARRAY);
  const activity = doc.getArray<ActivityItem>(ACTIVITY_ARRAY);

  let provider: WebsocketProvider | null = null;
  if (config.serverUrl) {
    provider = new WebsocketProvider(config.serverUrl, config.room, doc, {
      connect: true,
      params: config.token ? { token: config.token } : undefined,
    });
  }

  const destroy = () => {
    try {
      provider?.destroy();
    } catch {
      /* noop */
    }
    provider = null;
    try {
      doc.destroy();
    } catch {
      /* noop */
    }
  };

  return {
    doc,
    provider,
    fields,
    comments,
    activity,
    user: config.user,
    connected: false,
    destroy,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Context                                   */
/* -------------------------------------------------------------------------- */

interface CollaborationContextValue {
  core: CollaborationCore;
  config: CollaborationConfig;
  connected: boolean;
  synced: boolean;
  presence: PresenceState[];
  permissions: PermissionSet;
  setCursor: (cursor: PresenceState['cursor']) => void;
  applyFieldChange: (field: string, value: string) => void;
  subscribeToDoc: (listener: () => void) => () => void;
  addComment: (text: string, field?: string) => Comment | null;
  resolveComment: (id: string, resolved: boolean) => void;
  deleteComment: (id: string) => void;
  logActivity: (action: string, detail?: string) => void;
}

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export interface CollaborationProviderProps {
  config: CollaborationConfig;
  children: React.ReactNode;
}

export const CollaborationProvider: React.FC<CollaborationProviderProps> = ({
  config,
  children,
}) => {
  const coreRef = useRef<CollaborationCore | null>(null);
  if (!coreRef.current) {
    coreRef.current = createCore(config);
  }
  const core = coreRef.current;

  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [presence, setPresence] = useState<PresenceState[]>([]);

  const configRef = useRef(config);
  configRef.current = config;

  /* ------------------------- connection lifecycle ------------------------- */
  useEffect(() => {
    const provider = core.provider;
    if (!provider) {
      setConnected(true);
      setSynced(true);
      return;
    }

    const handleStatus = (event: { status: string }) => {
      setConnected(event.status === 'connected');
    };
    const handleSync = (isSynced: boolean) => {
      setSynced(isSynced);
    };

    provider.on('status', handleStatus);
    provider.on('sync', handleSync);

    setConnected(provider.wsconnected);
    setSynced(provider.synced);

    return () => {
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
    };
  }, [core]);

  /* ------------------------------ presence -------------------------------- */
  useEffect(() => {
    const provider = core.provider;
    if (!provider) {
      setPresence([{ user: core.user, cursor: null, lastSeen: Date.now() }]);
      return;
    }

    const awareness = provider.awareness;

    const publish = () => {
      awareness.setLocalStateField('user', core.user);
      if (!awareness.getLocalState()?.cursor) {
        awareness.setLocalStateField('cursor', null);
      }
    };
    publish();

    const update = () => {
      const states: PresenceState[] = [];
      awareness.getStates().forEach((state) => {
        const user = state?.user as CollaboratorUser | undefined;
        if (!user) return;
        states.push({
          user,
          cursor: (state?.cursor as PresenceState['cursor']) ?? null,
          lastSeen: (state?.lastSeen as number) ?? Date.now(),
        });
      });
      setPresence(states);
    };

    awareness.on('change', update);
    update();

    return () => {
      awareness.off('change', update);
    };
  }, [core]);

  /* ------------------------------ cleanup --------------------------------- */
  useEffect(() => {
    return () => {
      core.destroy();
      coreRef.current = null;
    };
  }, [core]);

  /* ------------------------------ helpers --------------------------------- */
  const setCursor = useCallback(
    (cursor: PresenceState['cursor']) => {
      const provider = core.provider;
      if (!provider) return;
      provider.awareness.setLocalStateField('cursor', cursor);
      provider.awareness.setLocalStateField('lastSeen', Date.now());
    },
    [core],
  );

  const applyFieldChange = useCallback(
    (field: string, value: string) => {
      const perms = buildPermissions(core.user.role);
      if (!perms.canEdit) return;
      core.doc.transact(() => {
        core.fields.set(field, value);
      });
    },
    [core],
  );

  const subscribeToDoc = useCallback(
    (listener: () => void) => {
      const handler = () => listener();
      core.doc.on('update', handler);
      return () => core.doc.off('update', handler);
    },
    [core],
  );

  const logActivity = useCallback(
    (action: string, detail?: string) => {
      const item: ActivityItem = {
        id: `${core.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: core.user.id,
        userName: core.user.name,
        action,
        detail,
        timestamp: Date.now(),
      };
      core.activity.push([item]);
      configRef.current.onActivity?.(item);
    },
    [core],
  );

  const addComment = useCallback(
    (text: string, field?: string): Comment | null => {
      const perms = buildPermissions(core.user.role);
      if (!perms.canComment) return null;
      const mentions = parseMentions(text);
      const comment: Comment = {
        id: `${core.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        authorId: core.user.id,
        authorName: core.user.name,
        text,
        mentions,
        createdAt: Date.now(),
        resolved: false,
        field,
      };
      core.comments.push([comment]);
      logActivity('commented', field ? `on ${field}` : undefined);

      const onMention = configRef.current.onMention;
      if (onMention) {
        mentions.forEach((mentionedUserId) => {
          if (mentionedUserId === core.user.id) return;
          onMention({
            mentionedUserId,
            comment,
            byUserId: core.user.id,
          });
        });
      }
      return comment;
    },
    [core, logActivity],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) => {
      const perms = buildPermissions(core.user.role);
      if (!perms.canResolveComment) return;
      const items = core.comments.toArray();
      const index = items.findIndex((c) => c.id === id);
      if (index === -1) return;
      const updated: Comment = { ...items[index], resolved };
      core.doc.transact(() => {
        core.comments.delete(index, 1);
        core.comments.insert(index, [updated]);
      });
      logActivity(resolved ? 'resolved comment' : 'reopened comment');
    },
    [core, logActivity],
  );

  const deleteComment = useCallback(
    (id: string) => {
      const perms = buildPermissions(core.user.role);
      if (!perms.canDelete) return;
      const items = core.comments.toArray();
      const index = items.findIndex((c) => c.id === id);
      if (index === -1) return;
      core.comments.delete(index, 1);
      logActivity('deleted comment');
    },
    [core, logActivity],
  );

  const permissions = useMemo(() => buildPermissions(core.user.role), [core.user.role]);

  const value = useMemo<CollaborationContextValue>(
    () => ({
      core,
      config,
      connected,
      synced,
      presence,
      permissions,
      setCursor,
      applyFieldChange,
      subscribeToDoc,
      addComment,
      resolveComment,
      deleteComment,
      logActivity,
    }),
    [
      core,
      config,
      connected,
      synced,
      presence,
      permissions,
      setCursor,
      applyFieldChange,
      subscribeToDoc,
      addComment,
      resolveComment,
      deleteComment,
      logActivity,
    ],
  );

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   Hooks                                    */
/* -------------------------------------------------------------------------- */

function useCollaborationContext(): CollaborationContextValue {
  const ctx = useContext(CollaborationContext);
  if (!ctx) {
    throw new Error(
      'Collaboration hooks must be used within a <CollaborationProvider>.',
    );
  }
  return ctx;
}

export function useCollaboration() {
  const ctx = useCollaborationContext();
  const [fields, setFields] = useState<Record<string, string>>(() =>
    ctx.core.fields.toJSON(),
  );

  useEffect(() => {
    const sync = () => setFields(ctx.core.fields.toJSON());
    sync();
    const observer = () => sync();
    ctx.core.fields.observe(observer);
    return () => ctx.core.fields.unobserve(observer);
  }, [ctx.core]);

  return {
    fields,
    connected: ctx.connected,
    synced: ctx.synced,
    applyFieldChange: ctx.applyFieldChange,
    subscribeToDoc: ctx.subscribeToDoc,
    doc: ctx.core.doc,
    user: ctx.core.user,
  };
}

export function usePresence() {
  const ctx = useCollaborationContext();
  const onlineMembers = useMemo(
    () => ctx.presence.map((p) => p.user),
    [ctx.presence],
  );
  return {
    presence: ctx.presence,
    onlineMembers,
    onlineCount: onlineMembers.length,
    setCursor: ctx.setCursor,
    connected: ctx.connected,
  };
}

export function useComments() {
  const ctx = useCollaborationContext();
  const [comments, setComments] = useState<Comment[]>(() =>
    ctx.core.comments.toArray(),
  );

  useEffect(() => {
    const sync = () => setComments(ctx.core.comments.toArray());
    sync();
    const observer = () => sync();
    ctx.core.comments.observe(observer);
    return () => ctx.core.comments.unobserve(observer);
  }, [ctx.core]);

  return {
    comments,
    addComment: ctx.addComment,
    resolveComment: ctx.resolveComment,
    deleteComment: ctx.deleteComment,
    parseMentions,
  };
}

export function useActivityFeed(limit = 50) {
  const ctx = useCollaborationContext();
  const [activity, setActivity] = useState<ActivityItem[]>(() =>
    ctx.core.activity.toArray(),
  );

  useEffect(() => {
    const sync = () => setActivity(ctx.core.activity.toArray());
    sync();
    const observer = () => sync();
    ctx.core.activity.observe(observer);
    return () => ctx.core.activity.unobserve(observer);
  }, [ctx.core]);

  const feed = useMemo(() => {
    return [...activity].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }, [activity, limit]);

  return {
    activity: feed,
    logActivity: ctx.logActivity,
  };
}

export function usePermissions(): PermissionSet {
  const ctx = useCollaborationContext();
  return ctx.permissions;
}

/* -------------------------------------------------------------------------- */
/*                              Default export                                */
/* -------------------------------------------------------------------------- */

export default CollaborationProvider;