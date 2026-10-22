import { useState, useEffect, useCallback } from 'react';
import {
  applyThemePreference,
  getSystemThemeQuery,
  readThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../utils/themePreference';

export type { ThemePreference } from '../utils/themePreference';

/**
 * Custom hook for theme management with system preference support.
 * 
 * @returns [currentTheme, setTheme, isDarkMode] tuple
 * - currentTheme: The user's theme preference ('system', 'light', or 'dark')
 * - setTheme: Function to update the theme preference
 * - isDarkMode: Boolean indicating if dark mode is active (considering system preference)
 */
export function useTheme(): [ThemePreference, (theme: ThemePreference) => void, boolean] {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState(() => getSystemThemeQuery()?.matches ?? false);
  const isDarkMode = theme === 'dark' || (theme === 'system' && systemDark);

  // App and ThemeProvider both consume this hook. Keep them (and other tabs)
  // on one preference rather than letting them overwrite each other's classes.
  useEffect(() => {
    const handlePreference = (event: Event) => {
      const preference = (event as CustomEvent<ThemePreference>).detail;
      if (preference === 'light' || preference === 'dark' || preference === 'system') {
        setThemeState(preference);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setThemeState(readThemePreference());
    };
    window.addEventListener(THEME_CHANGE_EVENT, handlePreference);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handlePreference);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const query = getSystemThemeQuery();
    if (!query) {
      setSystemDark(false);
      return;
    }
    const handleChange = () => setSystemDark(query.matches);
    handleChange();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(handleChange);
      return () => query.removeListener(handleChange);
    }
  }, [theme]);

  useEffect(() => {
    applyThemePreference(theme, systemDark);
  }, [theme, systemDark]);

  const setTheme = useCallback((newTheme: ThemePreference) => {
    if (!['system', 'light', 'dark'].includes(newTheme)) return;
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      localStorage.removeItem('dark-mode');
    } catch {
      // Manual overrides still work when persistence is unavailable.
    }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: newTheme }));
  }, []);

  return [theme, setTheme, isDarkMode];
}

/**
 * Cycles through theme preferences: system → light → dark → system
 */
export function cycleTheme(currentTheme: ThemePreference): ThemePreference {
  switch (currentTheme) {
    case 'system':
      return 'light';
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
    default:
      return 'system';
  }
}

/**
 * Gets the appropriate icon for the theme toggle button
 */
export function getThemeIcon(theme: ThemePreference, isDarkMode: boolean): string {
  if (theme === 'system') {
    return isDarkMode ? '☾' : '☀';
  }
  return theme === 'dark' ? '☾' : '☀';
}

/**
 * Gets the appropriate label for the theme toggle button
 */
export function getThemeLabel(theme: ThemePreference, isDarkMode: boolean, t: (key: string) => string): string {
  if (theme === 'system') {
    return isDarkMode ? t('app.darkMode') : t('app.lightMode');
  }
  return theme === 'dark' ? t('app.darkMode') : t('app.lightMode');
}
