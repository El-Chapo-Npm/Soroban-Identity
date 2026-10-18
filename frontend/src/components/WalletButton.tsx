import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { WalletType } from "../hooks/useWallet";
import { useWalletContext } from "../context/WalletContext";
import { useBiometricAuth } from "../hooks/useBiometricAuth";

interface BiometricDevice {
  id: string;
  name: string;
  registeredAt: string;
  transports?: string[];
}

function DeviceManagementPanel({
  devices,
  status,
  onRegister,
  onRemove,
}: {
  devices: BiometricDevice[];
  status: string;
  onRegister: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="region"
      aria-label={t("biometric.devices.title", "Biometric devices")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.5rem",
        border: "1px solid var(--border-input)",
        borderRadius: "0.5rem",
        minWidth: "220px",
      }}
    >
      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        {t("biometric.devices.title", "Biometric devices")}
      </span>
      {devices.length === 0 ? (
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {t("biometric.devices.empty", "No devices registered yet.")}
        </span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {devices.map((device) => (
            <li
              key={device.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
            >
              <span style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem" }}>
                <span>{device.name}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t("biometric.devices.registeredAt", "Registered {{date}}", {
                    date: device.registeredAt,
                  })}
                </span>
                {device.transports && device.transports.length > 0 && (
                  <span style={{ color: "var(--text-muted)" }}>
                    {t("biometric.devices.transports", "Transports: {{transports}}", {
                      transports: device.transports.join(", "),
                    })}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onRemove(device.id)}
                aria-label={t("biometric.devices.remove", "Remove device {{name}}", {
                  name: device.name,
                })}
                style={{
                  background: "none",
                  border: "1px solid var(--error-text)",
                  color: "var(--error-text)",
                  borderRadius: "0.25rem",
                  padding: "0.15rem 0.5rem",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {t("biometric.devices.removeAction", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onRegister}
        aria-label={t("biometric.devices.register", "Register this device")}
        style={{
          background: "transparent",
          border: "1px solid var(--border-input)",
          color: "var(--text)",
          borderRadius: "0.25rem",
          padding: "0.3rem 0.6rem",
          fontSize: "0.8rem",
          cursor: "pointer",
        }}
      >
        {t("biometric.devices.register", "Register this device")}
      </button>
      <span role="status" aria-live="polite" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
        {status}
      </span>
    </div>
  );
}

export default function WalletButton() {
  const { t } = useTranslation();
  const {
    isSupported: biometricSupported,
    devices: biometricDevices,
    registerDevice,
    removeDevice,
  } = useBiometricAuth();
  const [biometricStatus, setBiometricStatus] = useState("");
  const [showBiometricFallback, setShowBiometricFallback] = useState(false);
  const {
    connected,
    publicKey,
    connecting,
    reconnecting,
    txLoading,
    error,
    walletType,
    connect,
    disconnect,
    retry,
  } = useWalletContext();
  const [showPicker, setShowPicker] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

  const handleSelect = (type: WalletType) => {
    setShowPicker(false);
    connect(type);
  };

  const handleCopyAddress = useCallback(async () => {
    if (!publicKey) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(publicKey);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = publicKey;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand("copy");
        } finally {
          document.body.removeChild(textArea);
        }
        console.warn(
          "[WalletButton] Using fallback clipboard method for non-secure context",
        );
      }

      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (err) {
      console.error("[WalletButton] Failed to copy address:", err);
    }
  }, [publicKey]);

  const handleRegisterDevice = useCallback(async () => {
    if (!biometricSupported) {
      setShowBiometricFallback(true);
      setBiometricStatus(
        t(
          "biometric.unavailable",
          "Biometric authentication is unavailable. Use your wallet or password instead.",
        ),
      );
      return;
    }
    try {
      await registerDevice();
      setBiometricStatus(t("biometric.registerSuccess", "Device registered successfully."));
    } catch (err) {
      console.error("[WalletButton] Failed to register biometric device:", err);
      setShowBiometricFallback(true);
      setBiometricStatus(
        t("biometric.registerError", "Registration failed. Use your wallet or password instead."),
      );
    }
  }, [biometricSupported, registerDevice, t]);

  const handleRemoveDevice = useCallback(
    async (id: string) => {
      try {
        await removeDevice(id);
        setBiometricStatus(t("biometric.removeSuccess", "Device removed."));
      } catch (err) {
        console.error("[WalletButton] Failed to remove biometric device:", err);
        setBiometricStatus(t("biometric.removeError", "Failed to remove device."));
      }
    },
    [removeDevice, t],
  );

  const handleSwitchAccount = useCallback(async () => {
    try {
      if (walletType === "freighter") {
        // Trigger Freighter's account picker
        await (window as any).freighter.setAllowedHosts(
          [(window as any).location.hostname],
          () => {}
        );
        // Disconnect and reconnect to trigger account picker
        disconnect();
        setTimeout(() => connect("freighter"), 100);
      } else if (walletType === "walletconnect") {
        // For WalletConnect, disconnect and reconnect
        disconnect();
        setTimeout(() => connect("walletconnect"), 100);
      }
      setShowDropdown(false);
    } catch (err) {
      console.error("[WalletButton] Failed to switch account:", err);
    }
  }, [walletType, disconnect, connect]);

  // Handle outside clicks and Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showDropdown]);

  return (
    <div
      // Alignment is responsive (stretched in the mobile drawer); see
      // .wallet-button in styles/navigation.css.
      className="wallet-button"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        position: "relative",
      }}
    >
      {connected && publicKey ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", position: "relative" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            via {walletType === "walletconnect" ? "WalletConnect" : "Freighter"}
          </span>
          <button
            ref={triggerRef}
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={txLoading}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
            aria-label={`Wallet account ${short(publicKey)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              background: "transparent",
              border: "1px solid var(--border-input)",
              color: "var(--text)",
              padding: "0.3rem 0.7rem",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "0.85rem",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <span
              className="badge badge-green"
              title={publicKey}
              style={{ cursor: "default", padding: "0 0.3rem" }}
            >
              {short(publicKey)}
            </span>
            <span style={{ fontSize: "0.75rem" }}>▼</span>
          </button>

          {showDropdown && (
            <div
              ref={dropdownRef}
              role="menu"
              style={{
                position: "absolute",
                top: "calc(100% + 0.5rem)",
                right: 0,
                background: "var(--dropdown-bg)",
                border: "1px solid var(--border-input)",
                borderRadius: "0.5rem",
                padding: "0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0",
                minWidth: "180px",
                zIndex: 10,
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
              }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  handleCopyAddress();
                  setShowDropdown(false);
                }}
                style={{
                  justifyContent: "flex-start",
                  gap: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                  padding: "0.5rem 0.75rem",
                  background: "transparent",
                  border: "none",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textAlign: "left",
                  borderRadius: "0.25rem",
                  transition: "background-color 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {copyFeedback ? (
                  <>
                    <span>✓</span>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <span>📋</span>
                    <span>Copy Address</span>
                  </>
                )}
              </button>

              <button
                role="menuitem"
                onClick={handleSwitchAccount}
                style={{
                  justifyContent: "flex-start",
                  gap: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                  padding: "0.5rem 0.75rem",
                  background: "transparent",
                  border: "none",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textAlign: "left",
                  borderRadius: "0.25rem",
                  transition: "background-color 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span>🔄</span>
                <span>Switch Account</span>
              </button>

              <button
                role="menuitem"
                aria-label={`Disconnect wallet ${short(publicKey)}`}
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                style={{
                  justifyContent: "flex-start",
                  gap: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                  padding: "0.5rem 0.75rem",
                  background: "transparent",
                  border: "none",
                  color: "var(--error-text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textAlign: "left",
                  borderRadius: "0.25rem",
                  transition: "background-color 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--error-bg)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span>🚪</span>
                <span>Disconnect</span>
              </button>
            </div>
          )}
        </div>
      ) : reconnecting ? (
        // Automatic reconnect in progress — block user interaction to prevent
        // duplicate connection attempts racing with the ongoing reconnect flow.
        <button
          disabled
          aria-busy="true"
          aria-label="Reconnecting wallet"
          style={{ opacity: 0.7, cursor: "not-allowed" }}
        >
          ⟳ Reconnecting…
        </button>
      ) : (
        <>
          <button
            onClick={() => setShowPicker((v) => !v)}
            disabled={connecting}
            aria-label="Connect Freighter wallet"
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>

          {showPicker && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 0.5rem)",
                right: 0,
                background: "var(--dropdown-bg)",
                border: "1px solid var(--border-input)",
                borderRadius: "0.5rem",
                padding: "0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                minWidth: "180px",
                zIndex: 10,
              }}
            >
              <button
                onClick={() => handleSelect("freighter")}
                style={{
                  justifyContent: "flex-start",
                  gap: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                🪐 Freighter
              </button>
              <button
                onClick={() => handleSelect("walletconnect")}
                style={{
                  justifyContent: "flex-start",
                  gap: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                🔗 WalletConnect
              </button>
            </div>
          )}
        </>
      )}

      <DeviceManagementPanel
        devices={biometricDevices}
        status={biometricStatus}
        onRegister={handleRegisterDevice}
        onRemove={handleRemoveDevice}
      />

      {showBiometricFallback && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
          }}
        >
          <span>
            {t(
              "biometric.fallbackPrompt",
              "Biometric sign-in is unavailable. Please connect your wallet or enter your password to continue.",
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setShowBiometricFallback(false);
              setShowPicker(true);
            }}
            aria-label={t("biometric.useWallet", "Use wallet instead")}
            style={{
              alignSelf: "flex-start",
              background: "transparent",
              border: "1px solid var(--border-input)",
              color: "var(--text)",
              borderRadius: "0.25rem",
              padding: "0.2rem 0.5rem",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            {t("biometric.useWallet", "Use wallet instead")}
          </button>
        </div>
      )}

      {error && (
        <span
          role="status"
          aria-live="polite"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--error-text)" }}
        >
          {(() => {
            const msg =
              error instanceof Error
                ? error.message
                : typeof error === "string" && error
                  ? error
                  : "Wallet connection failed. Please try again.";
            return msg.toLowerCase().includes("freighter not found") ? (
              <>
                Freighter not installed.{" "}
                <a
                  href="https://freighter.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--accent-light)",
                    textDecoration: "underline",
                  }}
                >
                  Install it here
                </a>
              </>
            ) : (
              msg
            );
          })()}
          {!connecting && !reconnecting && !connected && (
            <button
              type="button"
              onClick={() => void retry()}
              aria-label="Retry wallet connection"
              style={{
                background: "none",
                border: "1px solid var(--error-text)",
                color: "var(--error-text)",
                borderRadius: "0.25rem",
                padding: "0.15rem 0.5rem",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              ↻ Reconnect
            </button>
          )}
        </span>
      )}
    </div>
  );
}
