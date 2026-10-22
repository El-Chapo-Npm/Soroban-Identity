import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  resetTheme as clearAppliedTheme,
  validateContrast as getContrastWarnings,
  loadTheme as loadPersistedTheme,
  saveTheme as persistTheme,
  clearTheme as clearPersistedTheme,
  PRESET_THEMES as prebuiltThemes,
  type ContrastWarning,
  type Theme,
} from "../theme";
import { useTheme as useThemePreference, type ThemePreference } from "../hooks/useTheme";
import { applyThemePreference, getSystemThemeQuery } from "../utils/themePreference";

interface ThemeContextValue {
  isDark: boolean;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  currentTheme: Theme | null;
  setCustomTheme: (theme: Theme) => void;
  resetTheme: () => void;
  availableThemes: Theme[];
  contrastWarnings: ContrastWarning[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreference, isDark] = useThemePreference();

  const [currentTheme, setCurrentTheme] = useState<Theme | null>(() => {
    try {
      return loadPersistedTheme();
    } catch {
      return null;
    }
  });

  const availableThemes = useMemo<Theme[]>(() => prebuiltThemes, []);

  const contrastWarnings = useMemo<ContrastWarning[]>(() => {
    if (!currentTheme) return [];
    try {
      return getContrastWarnings(currentTheme);
    } catch {
      return [];
    }
  }, [currentTheme]);

  // Apply custom theme via the theming engine, re-applying on mode changes.
  useEffect(() => {
    if (currentTheme) {
      try {
        applyTheme({ ...currentTheme, mode: isDark ? 'dark' : 'light' });
        document.documentElement.setAttribute('data-custom-theme', 'true');
      } catch {
        // Ignore application errors; keep base theme intact.
      }
    } else {
      try {
        clearAppliedTheme();
        document.documentElement.removeAttribute('data-custom-theme');
      } catch {
        // Ignore cleanup errors.
      }
    }
    applyThemePreference(themePreference, isDark);
  }, [currentTheme, isDark, themePreference]);

  const toggleTheme = useCallback(() => setThemePreference(isDark ? 'light' : 'dark'), [isDark, setThemePreference]);

  const setCustomTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
    try {
      persistTheme(theme);
    } catch {
      // Ignore persistence errors.
    }
  }, []);

  const resetTheme = useCallback(() => {
    setCurrentTheme(null);
    try {
      clearPersistedTheme();
      clearAppliedTheme();
      document.documentElement.removeAttribute('data-custom-theme');
      applyThemePreference(themePreference, getSystemThemeQuery()?.matches ?? false);
    } catch {
      // Ignore cleanup errors.
    }
  }, [themePreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      themePreference,
      setThemePreference,
      toggleTheme,
      currentTheme,
      setCustomTheme,
      resetTheme,
      availableThemes,
      contrastWarnings,
    }),
    [isDark, themePreference, setThemePreference, toggleTheme, currentTheme, setCustomTheme, resetTheme, availableThemes, contrastWarnings]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
