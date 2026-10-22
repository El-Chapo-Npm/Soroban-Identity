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
  clearAppliedTheme,
  getContrastWarnings,
  loadPersistedTheme,
  persistTheme,
  clearPersistedTheme,
  type ContrastWarning,
  type Theme,
} from "../utils/themeEngine";
import { prebuiltThemes } from "../utils/prebuiltThemes";

interface ThemeContextValue {
  isDark: boolean;
  toggleTheme: () => void;
  currentTheme: Theme | null;
  setCustomTheme: (theme: Theme) => void;
  resetTheme: () => void;
  availableThemes: Theme[];
  contrastWarnings: ContrastWarning[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("dark-mode");
    if (stored !== null) return stored === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

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

  // Apply dark/light mode class.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", isDark);
    html.classList.toggle("light", !isDark);
    localStorage.setItem("dark-mode", String(isDark));
  }, [isDark]);

  // Apply custom theme via the theming engine, re-applying on mode changes.
  useEffect(() => {
    if (currentTheme) {
      try {
        applyTheme(currentTheme, isDark);
      } catch {
        // Ignore application errors; keep base theme intact.
      }
    } else {
      try {
        clearAppliedTheme();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }, [currentTheme, isDark]);

  const toggleTheme = useCallback(() => setIsDark((d) => !d), []);

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
    } catch {
      // Ignore cleanup errors.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      toggleTheme,
      currentTheme,
      setCustomTheme,
      resetTheme,
      availableThemes,
      contrastWarnings,
    }),
    [isDark, toggleTheme, currentTheme, setCustomTheme, resetTheme, availableThemes, contrastWarnings]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}