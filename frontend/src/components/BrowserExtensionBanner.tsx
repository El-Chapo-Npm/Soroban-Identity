import React, { useState, useEffect } from "react";
import { isExtensionInstalled, syncCredentialsToExtension } from "../extension/extensionBridge";
import type { ExtensionCredential } from "../extension/types";
import { useToast } from "../context/ToastContext";

export interface BrowserExtensionBannerProps {
  credentials?: any[];
  className?: string;
}

export const BrowserExtensionBanner: React.FC<BrowserExtensionBannerProps> = ({
  credentials = [],
  className = "",
}) => {
  const toast = useToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    let mounted = true;
    void isExtensionInstalled().then((isInst) => {
      if (mounted) setInstalled(isInst);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSync = async () => {
    if (credentials.length === 0) {
      toast.warning("No credentials available to sync.");
      return;
    }

    setSyncing(true);
    try {
      const formatted: ExtensionCredential[] = credentials.map((c) => ({
        id: c.id || c.credentialId || "",
        issuer: c.issuer || "",
        subject: c.subject || "",
        credentialType: c.credentialType || c.type || "General",
        issuedAt: c.issuedAt || Date.now(),
        expiresAt: c.expiresAt || 0,
        claims: c.claims || {},
        status: c.isRevoked ? "revoked" : "valid",
      }));

      const res = await syncCredentialsToExtension(formatted);
      if (res.success) {
        toast.success(`Synced ${res.count} credential(s) to browser extension!`);
      } else {
        toast.error(res.error || "Extension sync failed.");
      }
    } catch {
      toast.error("Failed to sync with browser extension.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className={`browser-extension-banner ${className}`.trim()}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        background: "var(--bg-accent, #1e293b)",
        border: "1px solid var(--border-color, #334155)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
        fontSize: "0.875rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.25rem" }} aria-hidden="true">
          🧩
        </span>
        <div>
          <div style={{ fontWeight: 600 }}>Browser Extension Support</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>
            {installed
              ? "Extension active: One-click verify & auto-fill enabled."
              : "Verify credentials and auto-fill forms anywhere with the Soroban Identity extension."}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {installed && (
          <button
            type="button"
            className="btn-micro"
            onClick={() => void handleSync()}
            disabled={syncing}
            style={{
              padding: "0.35rem 0.75rem",
              background: "var(--primary-color, #2563eb)",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {syncing ? "Syncing…" : "Sync to Extension"}
          </button>
        )}
        <button
          type="button"
          className="btn-micro"
          onClick={() => setShowGuide(true)}
          style={{
            padding: "0.35rem 0.75rem",
            background: "transparent",
            color: "var(--text-color, #cbd5e1)",
            border: "1px solid var(--border-color, #475569)",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          {installed ? "Extension Info" : "Get Extension"}
        </button>
      </div>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.65)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--bg-card, #1e293b)",
              color: "var(--text-primary, #f8fafc)",
              border: "1px solid var(--border-color, #334155)",
              borderRadius: "0.75rem",
              maxWidth: "520px",
              width: "100%",
              padding: "1.5rem",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                🧩 Soroban Identity Browser Extension
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #94a3b8)" }}>
              The extension allows you to verify credentials with one click from context menus,
              auto-fill forms on external sites, and monitor expiring credentials with badge
              alerts.
            </p>

            <h4 style={{ fontSize: "0.9rem", margin: "0.75rem 0 0.25rem" }}>
              How to Install (Developer Mode):
            </h4>
            <ol style={{ fontSize: "0.8rem", paddingLeft: "1.25rem", lineHeight: 1.6 }}>
              <li>Open <code>chrome://extensions</code> (Chrome/Edge) or <code>about:debugging</code> (Firefox).</li>
              <li>Toggle <strong>Developer mode</strong> in the top-right.</li>
              <li>Click <strong>Load unpacked</strong> and select <code>frontend/src/extension</code>.</li>
            </ol>

            <h4 style={{ fontSize: "0.9rem", margin: "0.75rem 0 0.25rem" }}>Features Included:</h4>
            <ul style={{ fontSize: "0.8rem", paddingLeft: "1.25rem", lineHeight: 1.6 }}>
              <li>Right-click any text to <strong>Verify Credential ID</strong></li>
              <li>Auto-fill forms matching credential and DID fields</li>
              <li>Badge indicator alerts when credentials expire within 30 days</li>
              <li>Local encrypted storage syncing with this web app</li>
            </ul>

            <div style={{ marginTop: "1.25rem", textAlign: "right" }}>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  padding: "0.4rem 1rem",
                  background: "var(--primary-color, #2563eb)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrowserExtensionBanner;
