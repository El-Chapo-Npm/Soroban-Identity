import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  category: 'navigation' | 'actions' | 'ui';
  handler: () => void;
  preventDefault?: boolean;
  enabled?: boolean;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: KeyboardShortcut[];
  enabled?: boolean;
}

/**
 * Hook for registering and managing keyboard shortcuts
 * 
 * @param options - Configuration options
 * @param options.shortcuts - Array of keyboard shortcuts to register
 * @param options.enabled - Whether shortcuts are enabled (default: true)
 * 
 * @example
 * ```tsx
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     {
 *       key: 'k',
 *       ctrl: true,
 *       description: 'Open search',
 *       category: 'actions',
 *       handler: () => openSearch(),
 *     },
 *   ],
 * });
 * ```
 */
export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  const shortcutsRef = useRef(shortcuts);

  // Update ref when shortcuts change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in form elements
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const isEditable = target.isContentEditable;
    
    if (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      isEditable
    ) {
      // Exception: Allow Escape key in form elements
      if (event.key !== 'Escape') {
        return;
      }
    }

    const matchingShortcut = shortcutsRef.current.find((shortcut) => {
      if (shortcut.enabled === false) return false;

      const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatches = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey;
      const metaMatches = shortcut.meta ? event.metaKey : !event.metaKey;
      const shiftMatches = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const altMatches = shortcut.alt ? event.altKey : !event.altKey;

      return keyMatches && ctrlMatches && metaMatches && shiftMatches && altMatches;
    });

    if (matchingShortcut) {
      if (matchingShortcut.preventDefault !== false) {
        event.preventDefault();
      }
      matchingShortcut.handler();
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

/**
 * Hook for sequential keyboard shortcuts (e.g., "g" then "d")
 * 
 * @param shortcuts - Map of key sequences to handlers
 * @param options - Configuration options
 * 
 * @example
 * ```tsx
 * useSequentialShortcuts({
 *   'g,d': () => goToDIDs(),
 *   'g,c': () => goToCredentials(),
 * });
 * ```
 */
export function useSequentialShortcuts(
  shortcuts: Record<string, () => void>,
  options: { timeout?: number; enabled?: boolean } = {}
): void {
  const { timeout = 1000, enabled = true } = options;
  const sequenceRef = useRef<string[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetSequence = useCallback(() => {
    sequenceRef.current = [];
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in form elements
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const isEditable = target.isContentEditable;
    
    if (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      isEditable
    ) {
      return;
    }

    // Ignore modifier-only keys
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }

    // Add key to sequence
    sequenceRef.current.push(event.key.toLowerCase());

    // Check for matching shortcut
    const sequence = sequenceRef.current.join(',');
    const handler = shortcuts[sequence];

    if (handler) {
      event.preventDefault();
      handler();
      resetSequence();
      return;
    }

    // Check if sequence could still match
    const couldMatch = Object.keys(shortcuts).some((shortcut) =>
      shortcut.startsWith(sequence)
    );

    if (!couldMatch) {
      resetSequence();
      return;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout to reset sequence
    timeoutRef.current = setTimeout(resetSequence, timeout);
  }, [shortcuts, resetSequence, timeout]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, handleKeyDown]);
}

/**
 * Utility to get platform-specific modifier key label
 */
export function getModifierKey(): 'Ctrl' | 'Cmd' {
  return navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl';
}

/**
 * Format a keyboard shortcut for display
 * 
 * @example
 * formatShortcut({ key: 'k', ctrl: true }) // "Ctrl+K" or "Cmd+K"
 */
export function formatShortcut(shortcut: Pick<KeyboardShortcut, 'key' | 'ctrl' | 'meta' | 'shift' | 'alt'>): string {
  const parts: string[] = [];
  
  if (shortcut.ctrl || shortcut.meta) {
    parts.push(getModifierKey());
  }
  if (shortcut.shift) {
    parts.push('Shift');
  }
  if (shortcut.alt) {
    parts.push('Alt');
  }
  
  parts.push(shortcut.key.toUpperCase());
  
  return parts.join('+');
}
