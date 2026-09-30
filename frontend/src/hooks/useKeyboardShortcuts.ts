import { useEffect, useRef } from 'react';

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutDefinition {
  /** Key to match, compared case-insensitively against event.key. */
  key: string;
  /** Require Cmd (macOS) or Ctrl (other platforms) to be held. */
  meta?: boolean;
  /** Require Shift to be held. */
  shift?: boolean;
  /** Require Alt to be held. */
  alt?: boolean;
  /** Human readable description used for tooltips and the help modal. */
  description?: string;
  /** Handler invoked when the shortcut matches. */
  handler: ShortcutHandler;
}

export type ShortcutMap = Record<string, ShortcutDefinition>;

/**
 * Default shortcut mappings for power users.
 * Keys are stable identifiers so callers can reference them (e.g. for tooltips).
 */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  search: {
    key: 'k',
    meta: true,
    description: 'Open search',
    handler: () => {},
  },
  newDid: {
    key: 'n',
    meta: true,
    description: 'Create new DID',
    handler: () => {},
  },
  help: {
    key: '?',
    shift: true,
    description: 'Show keyboard shortcuts',
    handler: () => {},
  },
};

const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
};

/**
 * Returns true when the event target is an editable field where shortcuts
 * should be ignored so typing is not intercepted.
 */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Shortcut entry used by the help modal and `useKeyboardShortcuts`. */
export interface KeyboardShortcut {
  id?: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description?: string;
  category?: string;
  handler?: ShortcutHandler;
  enabled?: boolean;
  preventDefault?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  shortcuts?: KeyboardShortcut[];
}

const matchesShortcut = (event: KeyboardEvent, shortcut: KeyboardShortcut): boolean => {
  if (shortcut.enabled === false) return false;
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const wantsCtrl = Boolean(shortcut.ctrl || shortcut.meta);
  const hasCtrl = event.ctrlKey || event.metaKey;
  if (wantsCtrl !== hasCtrl) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;
  return true;
};

/**
 * Registers global keyboard shortcuts.
 * Escape still fires while focus is in an input; other shortcuts do not.
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions = {}): void {
  const { enabled = true, shortcuts = [] } = options;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);
      for (const shortcut of shortcutsRef.current) {
        if (editable && shortcut.key !== 'Escape') continue;
        if (!matchesShortcut(event, shortcut)) continue;
        if (shortcut.preventDefault !== false) event.preventDefault();
        shortcut.handler?.(event);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export interface UseSequentialShortcutsOptions {
  enabled?: boolean;
  timeout?: number;
}

/** Chord shortcuts such as `g,d`. Modifier keys are ignored. */
export function useSequentialShortcuts(
  sequences: Record<string, () => void>,
  options: UseSequentialShortcutsOptions = {},
): void {
  const { enabled = true, timeout = 1000 } = options;
  const sequencesRef = useRef(sequences);
  sequencesRef.current = sequences;
  const buffer = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const clear = () => {
      buffer.current = [];
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      buffer.current.push(event.key.toLowerCase());
      const joined = buffer.current.join(',');
      const known = Object.keys(sequencesRef.current);
      if (sequencesRef.current[joined]) {
        event.preventDefault();
        sequencesRef.current[joined]();
        clear();
        return;
      }
      if (!known.some((seq) => seq.startsWith(joined))) {
        clear();
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(clear, timeout);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clear();
    };
  }, [enabled, timeout]);
}

/** Label for the primary modifier on this platform (`Cmd` or `Ctrl`). */
export function getModifierKey(): 'Cmd' | 'Ctrl' {
  return isMac() ? 'Cmd' : 'Ctrl';
}

export const getModifierLabel = getModifierKey;

/** Render a shortcut as `Cmd+Shift+K` (or `Ctrl+…` off macOS). */
export function formatShortcut(shortcut: Pick<KeyboardShortcut, 'key' | 'ctrl' | 'meta' | 'shift' | 'alt'>): string {
  const parts: string[] = [];
  if (shortcut.ctrl || shortcut.meta) parts.push(getModifierKey());
  if (shortcut.alt) parts.push('Alt');
  if (shortcut.shift) parts.push('Shift');
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join('+');
}

export default useKeyboardShortcuts;
