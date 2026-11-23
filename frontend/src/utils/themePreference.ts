import { applyTheme, loadTheme } from '../theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'theme-preference';
export const THEME_CHANGE_EVENT = 'theme-preference-change';
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    // Migrate the old provider's override only when the canonical key is absent.
    if (stored === null) {
      const legacy = localStorage.getItem('dark-mode');
      if (legacy === 'true') return 'dark';
      if (legacy === 'false') return 'light';
    }
  } catch {
    // Storage can be unavailable in privacy mode or during server rendering.
  }
  return 'system';
}

export function getSystemThemeQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DARK_MEDIA_QUERY)
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the theme preference and resolved dark state already applied to the
 * document by the inline head script. Returns null when nothing has been
 * applied yet (e.g. server rendering or a non-browser environment).
 */
export function readAppliedThemePreference(): { preference: ThemePreference; dark: boolean } | null {
  if (typeof document === 'undefined') return null;
  const html = document.documentElement;
  const rawPreference = html.getAttribute('data-theme-preference');
  const preference: ThemePreference =
    rawPreference === 'light' || rawPreference === 'dark' || rawPreference === 'system'
      ? rawPreference
      : 'system';
  const appliedTheme = html.getAttribute('data-theme');
  if (appliedTheme !== 'dark' && appliedTheme !== 'light') return null;
  return { preference, dark: appliedTheme === 'dark' };
}

export function applyThemePreference(preference: ThemePreference, systemDark: boolean): void {
  if (typeof document === 'undefined') return;
  const dark = preference === 'dark' || (preference === 'system' && systemDark);
  const html = document.documentElement;
  html.classList.toggle('dark', dark);
  html.classList.toggle('light', !dark);
  html.setAttribute('data-theme', dark ? 'dark' : 'light');
  html.setAttribute('data-theme-mode', dark ? 'dark' : 'light');
  html.setAttribute('data-theme-preference', preference);
}

/** Run before mounting React, using the same preference as the hook/provider. */
export function initializeTheme(): void {
  if (typeof document === 'undefined') return;
  const preference = readThemePreference();
  const systemDark = getSystemThemeQuery()?.matches ?? false;
  const dark = preference === 'dark' || (preference === 'system' && systemDark);
  const customTheme = loadTheme();
  if (customTheme) {
    applyTheme({ ...customTheme, mode: dark ? 'dark' : 'light' });
    document.documentElement.setAttribute('data-custom-theme', 'true');
  }
  // The inline head script may have already applied the same state; skip the
  // redundant DOM writes so initialization stays idempotent and flash-free.
  const applied = readAppliedThemePreference();
  if (applied && applied.preference === preference && applied.dark === dark) return;
  applyThemePreference(preference, systemDark);
}
