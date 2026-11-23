import { useState } from "react";

const STORAGE_KEY = "soroban-identity.notification-preferences.v1";

export interface NotificationPreferences {
  email: boolean;
  inApp: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email: false,
  inApp: true,
};

function readPreferences(): NotificationPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PREFERENCES;
    const value = parsed as Partial<NotificationPreferences>;
    return {
      email: typeof value.email === "boolean" ? value.email : DEFAULT_PREFERENCES.email,
      inApp: typeof value.inApp === "boolean" ? value.inApp : DEFAULT_PREFERENCES.inApp,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [saveError, setSaveError] = useState(false);

  function updatePreference(key: keyof NotificationPreferences, checked: boolean) {
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <section
      aria-labelledby="notification-preferences-heading"
      className="notification-preferences"
    >
      <h2 id="notification-preferences-heading">Notification preferences</h2>
      <p>
        These preferences are saved in this browser only. Email delivery is not connected in this
        frontend-only setting.
      </p>
      <fieldset>
        <legend>Notification channels</legend>
        <div>
          <input
            id="notification-preference-email"
            type="checkbox"
            checked={preferences.email}
            onChange={(event) => updatePreference("email", event.currentTarget.checked)}
          />
          <label htmlFor="notification-preference-email">Email notifications</label>
        </div>
        <div>
          <input
            id="notification-preference-in-app"
            type="checkbox"
            checked={preferences.inApp}
            onChange={(event) => updatePreference("inApp", event.currentTarget.checked)}
          />
          <label htmlFor="notification-preference-in-app">In-app notifications</label>
        </div>
      </fieldset>
      <p role={saveError ? "alert" : "status"} aria-live={saveError ? "assertive" : "polite"}>
        {saveError
          ? "Could not save preferences in this browser."
          : "Changes are saved automatically on this device."}
      </p>
    </section>
  );
}
