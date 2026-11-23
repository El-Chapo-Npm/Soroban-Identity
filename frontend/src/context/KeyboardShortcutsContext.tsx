import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { KeyboardShortcut } from '../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsContextValue {
  shortcuts: KeyboardShortcut[];
  registerShortcuts: (shortcuts: KeyboardShortcut[]) => void;
  unregisterShortcuts: (shortcuts: KeyboardShortcut[]) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  showHelp: boolean;
  toggleHelp: () => void;
  customShortcuts: Record<string, Partial<KeyboardShortcut>>;
  updateShortcut: (id: string, updates: Partial<KeyboardShortcut>) => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

const STORAGE_KEY = 'keyboard-shortcuts-config';

interface StoredConfig {
  enabled: boolean;
  customShortcuts: Record<string, Partial<KeyboardShortcut>>;
}

function loadConfig(): StoredConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load keyboard shortcuts config:', error);
  }
  return { enabled: true, customShortcuts: {} };
}

function saveConfig(config: StoredConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Failed to save keyboard shortcuts config:', error);
  }
}

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  
  const [config, setConfig] = useState<StoredConfig>(loadConfig);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const registerShortcuts = useCallback((newShortcuts: KeyboardShortcut[]) => {
    setShortcuts((prev) => {
      // Remove any existing shortcuts with the same keys to avoid duplicates
      const filtered = prev.filter(
        (existing) =>
          !newShortcuts.some(
            (newShortcut) =>
              newShortcut.key === existing.key &&
              newShortcut.ctrl === existing.ctrl &&
              newShortcut.meta === existing.meta &&
              newShortcut.shift === existing.shift &&
              newShortcut.alt === existing.alt
          )
      );
      return [...filtered, ...newShortcuts];
    });
  }, []);

  const unregisterShortcuts = useCallback((shortcutsToRemove: KeyboardShortcut[]) => {
    setShortcuts((prev) =>
      prev.filter(
        (existing) =>
          !shortcutsToRemove.some(
            (toRemove) =>
              toRemove.key === existing.key &&
              toRemove.ctrl === existing.ctrl &&
              toRemove.meta === existing.meta &&
              toRemove.shift === existing.shift &&
              toRemove.alt === existing.alt
          )
      )
    );
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled }));
  }, []);

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  const updateShortcut = useCallback((id: string, updates: Partial<KeyboardShortcut>) => {
    setConfig((prev) => ({
      ...prev,
      customShortcuts: {
        ...prev.customShortcuts,
        [id]: { ...prev.customShortcuts[id], ...updates },
      },
    }));
  }, []);

  const value: KeyboardShortcutsContextValue = {
    shortcuts,
    registerShortcuts,
    unregisterShortcuts,
    enabled: config.enabled,
    setEnabled,
    showHelp,
    toggleHelp,
    customShortcuts: config.customShortcuts,
    updateShortcut,
  };

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error('useKeyboardShortcutsContext must be used within KeyboardShortcutsProvider');
  }
  return context;
}
