import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollaboratorPresence {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  role?: 'owner' | 'editor' | 'viewer' | string;
  online: boolean;
  lastSeen?: number;
  cursor?: {
    line: number;
    column: number;
    field?: string;
  } | null;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorColor?: string;
  body: string;
  createdAt: number;
  mentions?: string[];
  resolved?: boolean;
  replies?: Comment[];
}

export interface ActivityItem {
  id: string;
  actorId: string;
  actorName: string;
  actorColor?: string;
  action: string;
  target?: string;
  timestamp: number;
}

export interface CollaborationPanelProps {
  /** Currently connected collaborators (online + offline presence). */
  collaborators: CollaboratorPresence[];
  /** Comment threads for the current credential. */
  comments?: Comment[];
  /** Activity feed entries for the team. */
  activity?: ActivityItem[];
  /** Called when the user submits a new comment. */
  onAddComment?: (body: string, mentions: string[]) => void;
  /** Called when the user resolves / unresolves a comment. */
  onToggleResolve?: (commentId: string) => void;
  /** Called when the user replies to a comment. */
  onReply?: (commentId: string, body: string, mentions: string[]) => void;
  /** Called when the user selects a collaborator (e.g. to follow cursor). */
  onSelectCollaborator?: (id: string) => void;
  /** Optional className for the outer container. */
  className?: string;
  /** Optional title override. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const formatRelativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract @mention tokens from a comment body. Matches `@Name` where Name may
 * contain letters, numbers, dots, dashes and underscores.
 */
const extractMentions = (body: string): string[] => {
  const matches = body.match(/@([\w.-]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
};

// ---------------------------------------------------------------------------
// Online Members Avatar Strip
// ---------------------------------------------------------------------------

interface OnlineMembersProps {
  collaborators: CollaboratorPresence[];
  onSelect?: (id: string) => void;
}

const OnlineMembers: React.FC<OnlineMembersProps> = ({ collaborators, onSelect }) => {
  const online = useMemo(
    () => collaborators.filter((c) => c.online),
    [collaborators],
  );

  if (online.length === 0) {
    return (
      <div
        className="collab-online-empty"
        role="status"
        aria-live="polite"
        style={{
          color: 'var(--color-text-muted, #6b7280)',
          fontSize: 'var(--font-size-sm, 0.875rem)',
        }}
      >
        No one else is online
      </div>
    );
  }

  return (
    <div
      className="collab-online-members"
      role="group"
      aria-label={`${online.length} team member${online.length === 1 ? '' : 's'} online`}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)' }}
    >
      <ul
        style={{
          display: 'flex',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {online.map((member, index) => (
          <li
            key={member.id}
            style={{ marginLeft: index === 0 ? 0 : 'calc(var(--space-2, 8px) * -1)' }}
          >
            <button
              type="button"
              onClick={() => onSelect?.(member.id)}
              aria-label={`${member.name}${member.role ? `, ${member.role}` : ''}, online`}
              title={`${member.name}${member.role ? ` (${member.role})` : ''} — online`}
              style={{
                position: 'relative',
                width: 'var(--avatar-size, 32px)',
                height: 'var(--avatar-size, 32px)',
                borderRadius: '50%',
                border: '2px solid var(--color-surface, #ffffff)',
                background: member.color || 'var(--color-primary, #2563eb)',
                color: 'var(--color-on-primary, #ffffff)',
                fontSize: 'var(--font-size-xs, 0.75rem)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                overflow: 'hidden',
              }}
            >
              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span aria-hidden="true">{getInitials(member.name)}</span>
              )}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 'var(--presence-dot-size, 10px)',
                  height: 'var(--presence-dot-size, 10px)',
                  borderRadius: '50%',
                  background: 'var(--color-success, #22c55e)',
                  border: '2px solid var(--color-surface, #ffffff)',
                }}
              />
            </button>
          </li>
        ))}
      </ul>
      <span
        style={{
          color: 'var(--color-text-muted, #6b7280)',
          fontSize: 'var(--font-size-sm, 0.875rem)',
        }}
      >
        {online.length} online
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live Cursor Overlay
// ---------------------------------------------------------------------------

interface CursorOverlayProps {
  collaborators: CollaboratorPresence[];
  /** Optional container ref to position cursors relative to. */
  containerRef?: React.RefObject<HTMLElement>;
}

const CursorOverlay: React.FC<CursorOverlayProps> = ({ collaborators }) => {
  const active = useMemo(
    () => collaborators.filter((c) => c.online && c.cursor),
    [collaborators],
  );

  if (active.length === 0) return null;

  return (
    <div
      className="collab-cursor-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 'var(--z-cursor, 50)',
      }}
    >
      {active.map((member) => {
        const cursor = member.cursor!;
        // Position is expressed as a percentage of the editing surface so the
        // overlay stays in sync regardless of scroll position.
        const top = `calc(${cursor.line} * var(--line-height, 1.5em))`;
        const left = `calc(${cursor.column} * var(--char-width, 0.6em))`;
        return (
          <div
            key={member.id}
            className="collab-cursor"
            style={{
              position: 'absolute',
              top,
              left,
              transform: 'translateY(-2px)',
              transition: 'top 80ms linear, left 80ms linear',
            }}
          >
            <div
              style={{
                width: '2px',
                height: 'var(--line-height, 1.5em)',
                background: member.color || 'var(--color-primary, #2563eb)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: '-1.25em',
                left: 0,
                whiteSpace: 'nowrap',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm, 4px)',
                background: member.color || 'var(--color-primary, #2563eb)',
                color: 'var(--color-on-primary, #ffffff)',
                fontSize: 'var(--font-size-xs, 0.75rem)',
                fontWeight: 500,
              }}
            >
              {member.name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Mention Autocomplete
// ---------------------------------------------------------------------------

interface MentionAutocompleteProps {
  collaborators: CollaboratorPresence[];
  query: string;
  onSelect: (member: CollaboratorPresence) => void;
  onClose: () => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  collaborators,
  query,
  onSelect,
  onClose,
  activeIndex,
  onActiveIndexChange,
}) => {
  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return collaborators
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [collaborators, query]);

  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (matches.length === 0) {
      onClose();
    }
  }, [matches.length, onClose]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (matches.length === 0) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Mention suggestions"
      id="collab-mention-listbox"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        margin: '0 0 var(--space-1, 4px) 0',
        padding: 'var(--space-1, 4px)',
        listStyle: 'none',
        minWidth: '180px',
        maxHeight: '200px',
        overflowY: 'auto',
        background: 'var(--color-surface, #ffffff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 'var(--radius-md, 8px)',
        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))',
        zIndex: 'var(--z-dropdown, 100)',
      }}
    >
      {matches.map((member, index) => (
        <li
          key={member.id}
          role="option"
          aria-selected={index === activeIndex}
          id={`collab-mention-option-${member.id}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(member);
          }}
          onMouseEnter={() => onActiveIndexChange(index)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2, 8px)',
            padding: 'var(--space-1, 4px) var(--space-2, 8px)',
            borderRadius: 'var(--radius-sm, 4px)',
            cursor: 'pointer',
            background:
              index === activeIndex
                ? 'var(--color-surface-hover, #f3f4f6)'
                : 'transparent',
            color: 'var(--color-text, #111827)',
            fontSize: 'var(--font-size-sm, 0.875rem)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 'var(--avatar-size-sm, 20px)',
              height: 'var(--avatar-size-sm, 20px)',
              borderRadius: '50%',
              background: member.color || 'var(--color-primary, #2563eb)',
              color: 'var(--color-on-primary, #ffffff)',
              fontSize: 'var(--font-size-xs, 0.75rem)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {getInitials(member.name)}
          </span>
          <span>{member.name}</span>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Comment Composer
// ---------------------------------------------------------------------------

interface CommentComposerProps {
  collaborators: CollaboratorPresence[];
  onSubmit: (body: string, mentions: string[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}

const CommentComposer: React.FC<CommentComposerProps> = ({
  collaborators,
  onSubmit,
  placeholder = 'Add a comment… use @ to mention',
  autoFocus = false,
  compact = false,
}) => {
  const [value, setValue] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const closeMentions = useCallback(() => {
    setMentionQuery(null);
    setActiveIndex(0);
  }, []);

  const insertMention = useCallback((member: CollaboratorPresence) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const atIndex = before.lastIndexOf('@');
    if (atIndex === -1) return;
    const newBefore = `${before.slice(0, atIndex)}@${member.name} `;
    const next = newBefore + after;
    setValue(next);
    closeMentions();
    // Restore focus and caret position after the inserted mention.
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = newBefore.length;
      textarea.setSelectionRange(pos, pos);
    });
  }, [value, closeMentions]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    const caret = e.target.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const atIndex = before.lastIndexOf('@');
    if (atIndex !== -1) {
      const fragment = before.slice(atIndex + 1);
      // Only treat as mention if no whitespace between @ and caret.
      if (!/\s/.test(fragment)) {
        setMentionQuery(fragment);
        setActiveIndex(0);
        return;
      }
    }
    closeMentions();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null) {
      const matches = collaborators.filter((c) =>
        c.name.toLowerCase().includes(mentionQuery.toLowerCase()),
      );
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (matches.length ? (i + 1) % matches.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          matches.length ? (i - 1 + matches.length) % matches.length : 0,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (matches.length > 0) {
          e.preventDefault();
          insertMention(matches[activeIndex] ?? matches[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMentions();
        return;
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, extractMentions(trimmed));
    setValue('');
    closeMentions();
  };

  return (
    <div style={{ position: 'relative' }}>
      {mentionQuery !== null && (
        <MentionAutocomplete
          collaborators={collaborators}
          query={mentionQuery}
          onSelect={insertMention}
          onClose={closeMentions}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
        />
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={compact ? 2 : 3}
        aria-label="Comment body"
        aria-autocomplete="list"
        aria-controls={mentionQuery !== null ? 'collab-mention-listbox' : undefined}
        aria-activedescendant={
          mentionQuery !== null
            ? `collab-mention-option-${
                collaborators.filter((c) =>
                  c.name.toLowerCase().includes(mentionQuery.toLowerCase()),
                )[activeIndex]?.id ?? ''
              }`
            : undefined
        }
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          padding: 'var(--space-2, 8px)',
          borderRadius: 'var(--radius-md, 8px)',
          border: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-surface, #ffffff)',
          color: 'var(--color-text, #111827)',
          fontFamily: 'inherit',
          fontSize: 'var(--font-size-sm, 0.875rem)',
          lineHeight: 1.4,
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'var(--space-1, 4px)',
        }}
      >
        <span
          style={{
            color: 'var(--color-text-muted, #6b7280)',
            fontSize: 'var(--font-size-xs, 0.75rem)',
          }}
        >
          ⌘/Ctrl + Enter to send
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Post comment"
          style={{
            padding: 'var(--space-1, 4px) var(--space-3, 12px)',
            borderRadius: 'var(--radius-md, 8px)',
            border: 'none',
            background: value.trim()
              ? 'var(--color-primary, #2563eb)'
              : 'var(--color-border, #e5e7eb)',
            color: value.trim()
              ? 'var(--color-on-primary, #ffffff)'
              : 'var(--color-text-muted, #6b7280)',
            cursor: value.trim() ? 'pointer' : 'not-allowed',
            fontSize: 'var(--font-size-sm, 0.875rem)',
            fontWeight: 500,
          }}
        >
          Comment
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Comment Thread
// ---------------------------------------------------------------------------

interface CommentThreadProps {
  comments: Comment[];
  collaborators: CollaboratorPresence[];
  onAddComment?: (body: string, mentions: string[]) => void;
  onToggleResolve?: (commentId: string) => void;
  onReply?: (commentId: string, body: string, mentions: string[]) => void;
}

const renderCommentBody = (body: string): React.ReactNode => {
  const parts = body.split(/(@[\w.-]+)/g);
  return parts.map((part, index) => {
    if (/^@[\w.-]+$/.test(part)) {
      return (
        <span
          key={index}
          style={{
            color: 'var(--color-primary, #2563eb)',
            fontWeight: 500,
          }}
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

const CommentItem: React.FC<{
  comment: Comment;
  collaborators: CollaboratorPresence[];
  onToggleResolve?: (commentId: string) => void;
  onReply?: (commentId: string, body: string, mentions: string[]) => void;
  depth?: number;
}> = ({ comment, collaborators, onToggleResolve, onReply, depth = 0 }) => {
  const [replying, setReplying] = useState(false);

  return (
    <li
      style={{
        listStyle: 'none',
        marginLeft: depth > 0 ? 'var(--space-4, 16px)' : 0,
        padding: 'var(--space-2, 8px) 0',
        borderTop: depth === 0 ? '1px solid var(--color-border, #e5e7eb)' : 'none',
        opacity: comment.resolved ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-2, 8px)' }}>
        <span
          aria-hidden="true"
          style={{
            width: 'var(--avatar-size-sm, 24px)',
            height: 'var(--avatar-size-sm, 24px)',
            borderRadius: '50%',
            background: comment.authorColor || 'var(--color-primary, #2563eb)',
            color: 'var(--color-on-primary, #ffffff)',
            fontSize: 'var(--font-size-xs, 0.75rem)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {getInitials(comment.authorName)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2, 8px)',
              flexWrap: 'wrap',
            }}
          >
            <strong
              style={{
                color: 'var(--color-text, #111827)',
                fontSize: 'var(--font-size-sm, 0.875rem)',
              }}
            >
              {comment.authorName}
            </strong>
            <time
              dateTime={new Date(comment.createdAt).toISOString()}
              style={{
                color: 'var(--color-text-muted, #6b7280)',
                fontSize: 'var(--font-size-xs, 0.75rem)',
              }}
            >
              {formatRelativeTime(comment.createdAt)}
            </time>
            {comment.resolved && (
              <span
                style={{
                  color: 'var(--color-success, #22c55e)',
                  fontSize: 'var(--font-size-xs, 0.75rem)',
                }}
              >
                ✓ Resolved
              </span>
            )}
          </div>
          <p
            style={{
              margin: 'var(--space-1, 4px) 0',
              color: 'var(--color-text, #111827)',
              fontSize: 'var(--font-size-sm, 0.875rem)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {renderCommentBody(comment.body)}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2, 8px)' }}>
            {onReply && (
              <button
                type="button"
                onClick={() => setReplying((r) => !r)}
                aria-expanded={replying}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--color-primary, #2563eb)',
                  fontSize: 'var(--font-size-xs, 0.75rem)',
                }}
              >
                Reply
              </button>
            )}
            {onToggleResolve && (
              <button
                type="button"
                onClick={() => onToggleResolve(comment.id)}
                aria-label={
                  comment.resolved
                    ? `Unresolve comment by ${comment.authorName}`
                    : `Resolve comment by ${comment.authorName}`
                }
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--color-text-muted, #6b7280)',
                  fontSize: 'var(--font-size-xs, 0.75rem)',
                }}
              >
                {comment.resolved ? 'Unresolve' : 'Resolve'}
              </button>
            )}
          </div>
          {replying && onReply && (
            <div style={{ marginTop: 'var(--space-2, 8px)' }}>
              <CommentComposer
                collaborators={collaborators}
                compact
                autoFocus
                placeholder="Write a reply…"
                onSubmit={(body, mentions) => {
                  onReply(comment.id, body, mentions);
                  setReplying(false);
                }}
              />
            </div>
          )}
          {comment.replies && comment.replies.length > 0 && (
            <ul style={{ margin: 'var(--space-2, 8px) 0 0 0', padding: 0 }}>
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  collaborators={collaborators}
                  depth={depth + 1}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
};

const CommentThread: React.FC<CommentThreadProps> = ({
  comments,
  collaborators,
  onAddComment,
  onToggleResolve,
  onReply,
}) => {
  const [showResolved, setShowResolved] = useState(false);
  const visible = useMemo(
    () => comments.filter((c) => showResolved || !c.resolved),
    [comments, showResolved],
  );
  const resolvedCount = useMemo(
    () => comments.filter((c) => c.resolved).length,
    [comments],
  );

  return (
    <section aria-label="Comment threads" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2, 8px)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 'var(--font-size-md, 1rem)',
            color: 'var(--color-text, #111827)',
          }}
        >
          Comments ({comments.length})
        </h3>
        {resolvedCount > 0 && (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1, 4px)',
              color: 'var(--color-text-muted, #6b7280)',
              fontSize: 'var(--font-size-xs, 0.75rem)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved ({resolvedCount})
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-muted, #6b7280)',
            fontSize: 'var(--font-size-sm, 0.875rem)',
          }}
        >
          No comments yet. Start the conversation below.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0 }}>
          {visible.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              collaborators={collaborators}
              onToggleResolve={onToggleResolve}
              onReply={onReply}
            />
          ))}
        </ul>
      )}

      {onAddComment && (
        <CommentComposer collaborators={collaborators} onSubmit={onAddComment} />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  activity: ActivityItem[];
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ activity }) => {
  const sorted = useMemo(
    () => [...activity].sort((a, b) => b.timestamp - a.timestamp),
    [activity],
  );

  return (
    <section aria-label="Team activity feed">
      <h3
        style={{
          margin: '0 0 var(--space-2, 8px) 0',
          fontSize: 'var(--font-size-md, 1rem)',
          color: 'var(--color-text, #111827)',
        }}
      >
        Activity
      </h3>
      {sorted.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-muted, #6b7280)',
            fontSize: 'var(--font-size-sm, 0.875rem)',
          }}
        >
          No recent activity.
        </p>
      ) : (
        <ul
          role="feed"
          aria-busy="false"
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2, 8px)',
            maxHeight: 'var(--activity-max-height, 320px)',
            overflowY: 'auto',
          }}
        >
          {sorted.map((item) => (
            <li
              key={item.id}
              style={{
                display: 'flex',
                gap: 'var(--space-2, 8px)',
                alignItems: 'flex-start',
                fontSize: 'var(--font-size-sm, 0.875rem)',
                color: 'var(--color-text, #111827)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 'var(--avatar-size-sm, 24px)',
                  height: 'var(--avatar-size-sm, 24px)',
                  borderRadius: '50%',
                  background: item.actorColor || 'var(--color-primary, #2563eb)',
                  color: 'var(--color-on-primary, #ffffff)',
                  fontSize: 'var(--font-size-xs, 0.75rem)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {getInitials(item.actorName)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span>
                  <strong>{item.actorName}</strong> {item.action}
                  {item.target ? (
                    <>
                      {' '}
                      <span style={{ color: 'var(--color-primary, #2563eb)' }}>
                        {item.target}
                      </span>
                    </>
                  ) : null}
                </span>
                <div
                  style={{
                    color: 'var(--color-text-muted, #6b7280)',
                    fontSize: 'var(--font-size-xs, 0.75rem)',
                  }}
                >
                  <time dateTime={new Date(item.timestamp).toISOString()}>
                    {formatRelativeTime(item.timestamp)}
                  </time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

type TabKey = 'comments' | 'activity';

export const CollaborationPanel: React.FC<CollaborationPanelProps> = ({
  collaborators,
  comments = [],
  activity = [],
  onAddComment,
  onToggleResolve,
  onReply,
  onSelectCollaborator,
  className,
  title = 'Collaboration',
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('comments');
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    comments: null,
    activity: null,
  });

  const tabs: TabKey[] = ['comments', 'activity'];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.indexOf(activeTab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab(tabs[0]);
      tabRefs.current[tabs[0]]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = tabs[tabs.length - 1];
      setActiveTab(last);
      tabRefs.current[last]?.focus();
    }
  };

  return (
    <aside
      className={className}
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3, 12px)',
        padding: 'var(--space-3, 12px)',
        background: 'var(--color-surface, #ffffff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 'var(--radius-lg, 12px)',
        color: 'var(--color-text, #111827)',
        fontFamily: 'inherit',
        position: 'relative',
        minWidth: 'var(--collab-panel-min-width, 280px)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-2, 8px)',
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--font-size-lg, 1.125rem)',
            color: 'var(--color-text, #111827)',
          }}
        >
          {title}
        </h2>
        <OnlineMembers
          collaborators={collaborators}
          onSelect={onSelectCollaborator}
        />
      </header>

      <div
        role="tablist"
        aria-label="Collaboration views"
        style={{
          display: 'flex',
          gap: 'var(--space-1, 4px)',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
        }}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              role="tab"
              id={`collab-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`collab-tabpanel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={handleTabKeyDown}
              style={{
                padding: '