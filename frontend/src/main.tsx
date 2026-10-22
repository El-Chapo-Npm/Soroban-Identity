import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { WalletProvider } from "./context/WalletContext";
import { ThemeProvider } from "./context/ThemeContext";
import { KeyboardShortcutsProvider } from "./context/KeyboardShortcutsContext";
import "./i18n";
import "./index.css";
import "./styles/index.css";

// Initialize theme before React renders to prevent flicker
(function initializeTheme() {
  const THEME_STORAGE_KEY = 'theme-preference';
  const CUSTOM_THEME_STORAGE_KEY = 'custom-theme';
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as 'system' | 'light' | 'dark' | null;
  const html = document.documentElement;
  
  // Remove any existing theme classes
  html.classList.remove('light', 'dark');
  
  if (storedTheme === 'light') {
    html.classList.add('light');
  } else if (storedTheme === 'dark') {
    html.classList.add('dark');
  }
  // If theme is 'system' or null, we don't add any class - CSS media query handles it
  
  // Set data attribute for immediate access
  html.setAttribute('data-theme', storedTheme || 'system');

  // Apply persisted custom theme CSS variables before first paint
  try {
    const rawCustomTheme = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (rawCustomTheme) {
      const customTheme = JSON.parse(rawCustomTheme) as {
        colors?: Record<string, string>;
      } | null;
      if (customTheme && customTheme.colors) {
        Object.entries(customTheme.colors).forEach(([token, value]) => {
          if (typeof value === 'string' && value) {
            const variableName = token.startsWith('--') ? token : `--color-${token}`;
            html.style.setProperty(variableName, value);
          }
        });
        html.setAttribute('data-custom-theme', 'true');
      }
    }
  } catch {
    // Ignore malformed stored theme data
  }
})();

// Initialize the animation system before React renders so CSS can gate
// animations and the transition wrapper is ready before the first paint.
(function initializeAnimations() {
  const html = document.documentElement;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const applyMotionPreference = (prefersReducedMotion: boolean) => {
    html.setAttribute('data-reduced-motion', prefersReducedMotion ? 'true' : 'false');
    html.classList.toggle('reduced-motion', prefersReducedMotion);
  };

  applyMotionPreference(reducedMotionQuery.matches);

  // Keep the attribute in sync if the user changes the OS setting at runtime
  const handleChange = (event: MediaQueryListEvent) => {
    applyMotionPreference(event.matches);
  };

  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleChange);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    // Fallback for older browsers
    reducedMotionQuery.addListener(handleChange);
  }

  // Mark the document as animation-ready so the transition wrapper can be
  // mounted/activated before the first render.
  html.setAttribute('data-animations-ready', 'true');
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <WalletProvider>
          <KeyboardShortcutsProvider>
            <App />
          </KeyboardShortcutsProvider>
        </WalletProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Register service worker for offline support and PWA caching
import("./serviceWorker").then((sw) => {
  sw.register();
});

