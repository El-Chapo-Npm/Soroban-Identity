import { useEffect } from 'react';
import {
  DEFAULT_SHORTCUTS,
  getModifierLabel,
  type ShortcutDefinition,
} from '../hooks/useKeyboardShortcuts';

interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
  shortcuts?: ShortcutDefinition[];
}

/**
 * Help modal listing available keyboard shortcuts.
 * Opened by pressing "?" (see useKeyboardShortcuts).
 */
export function ShortcutHelpModal({
  open,
  onClose,
  shortcuts = DEFAULT_SHORTCUTS,
}: ShortcutHelpModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const modifier = getModifierLabel();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-gray-700"
          >
            \u2715
          </button>
        </div>
        <ul className="space-y-2">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.id} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{shortcut.description}</span>
              <kbd className="rounded border border-gray-300 bg-gray-100 px-2 py-1 text-xs font-mono">
                {shortcut.modifier ? `${modifier}+` : ''}
                {shortcut.shift ? 'Shift+' : ''}
                {shortcut.key.toUpperCase()}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ShortcutHelpModal;
