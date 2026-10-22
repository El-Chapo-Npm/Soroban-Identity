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
import { initializeTheme } from "./utils/themePreference";

// Initialize theme before React renders to prevent flicker
initializeTheme();

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
