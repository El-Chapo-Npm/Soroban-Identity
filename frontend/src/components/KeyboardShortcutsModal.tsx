import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useKeyboardShortcutsContext } from '../context/KeyboardShortcutsContext';
import { formatShortcut, getModifierKey } from '../hooks/useKeyboardShortcuts';
import type { KeyboardShortcut } from '../hooks/useKeyboardShortcuts';
import './KeyboardShortcutsModal.css';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const { shortcuts, enabled, setEnabled } = useKeyboardShortcutsContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
      // Focus close button when opened
      closeButtonRef.current?.focus();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    const handleClick = (e: MouseEvent) => {
      // Close when clicking on backdrop
      const rect = dialog.getBoundingClientRect();
      const isInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;

      if (!isInDialog) {
        onClose();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleClick);

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  const groupedShortcuts = shortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<string, KeyboardShortcut[]>
  );

  const categoryLabels: Record<string, string> = {
    navigation: t('shortcuts.category.navigation'),
    actions: t('shortcuts.category.actions'),
    ui: t('shortcuts.category.ui'),
  };

  const categoryOrder = ['navigation', 'actions', 'ui'];

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-modal"
      aria-labelledby="shortcuts-modal-title"
      aria-describedby="shortcuts-modal-description"
    >
      <div className="shortcuts-modal-content">
        <header className="shortcuts-modal-header">
          <h2 id="shortcuts-modal-title">{t('shortcuts.title')}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="shortcuts-modal-close"
            onClick={onClose}
            aria-label={t('shortcuts.close')}
          >
            ✕
          </button>
        </header>

        <p id="shortcuts-modal-description" className="shortcuts-modal-description">
          {t('shortcuts.description')}
        </p>

        <div className="shortcuts-toggle">
          <label htmlFor="shortcuts-enabled">
            <input
              id="shortcuts-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('shortcuts.enableShortcuts')}
          </label>
        </div>

        {enabled && (
          <div className="shortcuts-list">
            {categoryOrder.map((category) => {
              const categoryShortcuts = groupedShortcuts[category];
              if (!categoryShortcuts || categoryShortcuts.length === 0) return null;

              return (
                <section key={category} className="shortcuts-category">
                  <h3 className="shortcuts-category-title">{categoryLabels[category]}</h3>
                  <table className="shortcuts-table">
                    <thead className="sr-only">
                      <tr>
                        <th>{t('shortcuts.table.shortcut')}</th>
                        <th>{t('shortcuts.table.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryShortcuts.map((shortcut, index) => (
                        <tr key={`${category}-${index}`}>
                          <td className="shortcuts-keys">
                            <kbd className="shortcut-kbd">
                              {formatShortcut(shortcut)}
                            </kbd>
                          </td>
                          <td className="shortcuts-description">{shortcut.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        )}

        <footer className="shortcuts-modal-footer">
          <p className="shortcuts-hint">
            {t('shortcuts.hint', { key: getModifierKey() })}
          </p>
        </footer>
      </div>
    </dialog>
  );
}
