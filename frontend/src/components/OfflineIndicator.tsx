import { useServiceWorker } from "../hooks/useServiceWorker";
import "./OfflineIndicator.css";

/**
 * Displays an indicator when the application is offline
 */
export default function OfflineIndicator() {
  const { isOnline, isRegistered } = useServiceWorker();

  // Don't show indicator if online or SW not registered
  if (isOnline || !isRegistered) {
    return null;
  }

  return (
    <div className="offline-indicator" role="status" aria-live="polite">
      <div className="offline-indicator-content">
        <svg
          className="offline-indicator-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="offline-indicator-text">
          You are offline. Some features may be limited.
        </span>
      </div>
    </div>
  );
}
