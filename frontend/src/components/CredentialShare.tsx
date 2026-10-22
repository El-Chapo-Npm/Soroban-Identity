import React, { useEffect, useState } from "react";
import type { Credential } from "../../../sdk/src/types";
import { trackShareEvent } from "../utils/credentialCrypto";
import { useToast } from "../context/ToastContext";
import SocialShare from "./SocialShare";
import { useOpenGraphMeta } from "../hooks/useOpenGraphMeta";

type PrivacyMode = "public" | "private" | "selective";

interface CredentialShareProps {
  credential: Credential;
  onClose?: () => void;
}

const API_BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? "";

/**
 * Renders a shareable preview card (credential type + verification URL) to a
 * PNG data URL using an offscreen canvas.
 */
const generatePreviewImage = (credential: Credential, verificationUrl: string): string => {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1e3a8a");
  gradient.addColorStop(1, "#2563eb");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Card
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(60, 60, width - 120, height - 120);

  // Title
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("Verified Credential", 120, 140);

  // Credential type
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.fillStyle = "#bfdbfe";
  ctx.fillText(credential.credentialType || "Credential", 120, 260);

  // Verification URL
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillStyle = "#e0e7ff";
  const displayUrl =
    verificationUrl.length > 70 ? `${verificationUrl.slice(0, 67)}...` : verificationUrl;
  ctx.fillText(displayUrl, 120, 380);

  // Footer
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillStyle = "#c7d2fe";
  ctx.fillText("Verify authenticity at the link above", 120, 470);

  return canvas.toDataURL("image/png");
};

export const CredentialShare: React.FC<CredentialShareProps> = ({ credential, onClose }) => {
  const toast = useToast();
  const [expiryHours, setExpiryHours] = useState<number>(24);
  const [shareUrl, setShareUrl] = useState<string>("");
  const [shortUrl, setShortUrl] = useState<string>("");
  const [previewImage, setPreviewImage] = useState<string>("");
  const [generating, setGenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("private");

  const effectiveShareUrl = shortUrl || shareUrl;

  useOpenGraphMeta({
    title: `Verified Credential: ${credential.credentialType || "Credential"}`,
    description:
      privacyMode === "public"
        ? `View and verify this ${credential.credentialType || "credential"} shared securely.`
        : "Verify the authenticity of this shared credential.",
    url: effectiveShareUrl,
    image: previewImage,
    type: "website",
  });

  useEffect(() => {
    if (!effectiveShareUrl) {
      setPreviewImage("");
      return;
    }
    try {
      setPreviewImage(generatePreviewImage(credential, effectiveShareUrl));
    } catch (err) {
      console.error("Failed to generate preview image:", err);
      setPreviewImage("");
    }
  }, [effectiveShareUrl, credential]);

  const requestShortLink = async (longUrl: string): Promise<string> => {
    try {
      const response = await fetch(`${API_BASE_URL}/share/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: longUrl,
          credentialId: credential.id,
          privacyMode,
          expiryHours,
        }),
      });
      if (!response.ok) {
        throw new Error(`Shorten request failed with status ${response.status}`);
      }
      const data = (await response.json()) as { shortUrl?: string; url?: string };
      return data.shortUrl ?? data.url ?? "";
    } catch (err) {
      console.error("Failed to create short link:", err);
      return "";
    }
  };

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      // Deep link format: app.com/verify?c=<ciphertext>&k=<key>
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set("verify", credential.id);

      if (privacyMode === "private") {
        // Private: encrypt the raw claims; only link holders can decrypt.
        const { key, keyString } = await generateEncryptionKey();
        const expiryMs = expiryHours * 60 * 60 * 1000;
        const encryptedData = await encryptCredentialData(credential, key, expiryMs);
        url.searchParams.set("c", encryptedData);
        url.searchParams.set("k", keyString);
      } else if (privacyMode === "selective") {
        // Selective: include only the credential type, never the claims.
        url.searchParams.set("type", credential.credentialType || "");
      }
      // Public: verification URL only; the verifier resolves the credential.

      setShareUrl(generatedLink);

      const short = await requestShortLink(generatedLink);
      setShortUrl(short);

      trackShareEvent("credential_share_link_created", {
        credentialId: credential.id,
        credentialType: credential.credentialType,
        expiryHours,
        privacyMode,
        shortLink: Boolean(short),
      });

      toast.success(
        short ? "Shareable short link generated!" : "Shareable encrypted link generated!"
      );
    } catch (err: unknown) {
      console.error("Failed to generate share link:", err);
      toast.error("Failed to encrypt credential.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!effectiveShareUrl) return;
    try {
      await navigator.clipboard.writeText(effectiveShareUrl);
      setCopied(true);
      trackShareEvent("credential_share_link_copied", {
        credentialId: credential.id,
        privacyMode,
      });
      privacyAudit.log({
        action: "share_copied",
        credentialId: credential.id,
        credentialType: credential.credentialType,
        visibility,
        disclosedAttributes,
        verifierId: verifierId.trim() || undefined,
        expiryHours,
      });
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error("Copy failed:", err);
      toast.error("Failed to copy to clipboard.");
    }
  };

  const handleRevoke = () => {
    privacyAudit.log({
      action: "share_revoked",
      credentialId: credential.id,
      credentialType: credential.credentialType,
      visibility,
      disclosedAttributes,
      verifierId: verifierId.trim() || undefined,
      expiryHours,
    });
    setShareUrl("");
    toast.success("Share link revoked.");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "540px",
          background: "var(--card-bg, #ffffff)",
          color: "var(--text, #1e293b)",
          borderRadius: "0.75rem",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
          padding: "1.5rem",
          position: "relative",
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
          <h3 id="share-modal-title" style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
            Share Credential Securely
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                cursor: "pointer",
                color: "var(--text-muted, #64748b)",
              }}
            >
              ✕
            </button>
          )}
        </div>

        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--text-muted, #64748b)",
            marginTop: 0,
            marginBottom: "1.25rem",
          }}
        >
          Generate an encrypted deep link. The raw claims are encrypted client-side using the Web
          Crypto API (AES-GCM-256) and can only be decrypted by someone with the link.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            Credential ID:
          </div>
          <code
            style={{
              display: "block",
              padding: "0.5rem",
              backgroundColor: "var(--bg-accent, #f1f5f9)",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              wordBreak: "break-all",
            }}
          >
            {credential.id}
          </code>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            htmlFor="visibility-select"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: "0.35rem",
            }}
          >
            Visibility:
          </label>
          <select
            id="visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as CredentialVisibility)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              backgroundColor: "var(--card-bg, #ffffff)",
              color: "var(--text, #1e293b)",
            }}
          >
            <option value="private">Private — only you</option>
            <option value="custom">Custom — selected attributes only</option>
            <option value="public">Public — anyone with the link</option>
          </select>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            htmlFor="verifier-input"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: "0.35rem",
            }}
          >
            Trusted verifier (optional):
          </label>
          <input
            id="verifier-input"
            type="text"
            value={verifierId}
            onChange={(e) => setVerifierId(e.target.value)}
            placeholder="Verifier ID or DID"
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              backgroundColor: "var(--card-bg, #ffffff)",
              color: "var(--text, #1e293b)",
            }}
          />
          {whitelistWarning && (
            <p
              role="alert"
              style={{ fontSize: "0.75rem", color: "#b45309", margin: "0.35rem 0 0" }}
            >
              ⚠ This verifier is not on your trusted whitelist. Sharing outside the whitelist is
              not recommended.
            </p>
          )}
        </div>

        <SelectiveDisclosure
          attributes={availableAttributes}
          selected={disclosedAttributes}
          onChange={setDisclosedAttributes}
        />

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            htmlFor="expiry-select"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: "0.35rem",
            }}
          >
            Link Expiration (default 24h):
          </label>
          <select
            id="expiry-select"
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              backgroundColor: "var(--card-bg, #ffffff)",
              color: "var(--text, #1e293b)",
            }}
          >
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours (Default)</option>
            <option value={48}>48 hours</option>
            <option value={168}>7 days</option>
          </select>
        </div>

        {!shareUrl ? (
          <>
            <fieldset
              style={{
                border: "none",
                padding: 0,
                margin: "0 0 1rem 0",
              }}
            >
              <legend
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "0.35rem",
                  padding: 0,
                }}
              >
                Privacy
              </legend>
              {(
                [
                  {
                    value: "public",
                    label: "Public",
                    hint: "Share the verification link and credential type openly.",
                  },
                  {
                    value: "private",
                    label: "Private",
                    hint: "Encrypt the claims; only link holders can decrypt.",
                  },
                  {
                    value: "selective",
                    label: "Selective",
                    hint: "Share only the credential type; claims stay hidden.",
                  },
                ] as { value: PrivacyMode; label: string; hint: string }[]
              ).map((option) => (
                <label
                  key={option.value}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "flex-start",
                    marginBottom: "0.5rem",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="privacy-mode"
                    value={option.value}
                    checked={privacyMode === option.value}
                    onChange={() => setPrivacyMode(option.value)}
                    style={{ width: "auto", margin: "0.15rem 0 0 0" }}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.75rem",
                        color: "var(--text-muted, #64748b)",
                      }}
                    >
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              onClick={handleGenerateLink}
              disabled={generating}
              style={{
                width: "100%",
                padding: "0.65rem 1rem",
                backgroundColor: "var(--accent-light, #2563eb)",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: generating ? "not-allowed" : "pointer",
                opacity: generating ? 0.7 : 1,
              }}
            >
              {generating ? "Encrypting & Generating Link…" : "Generate Encrypted Deep Link"}
            </button>
          </>
        ) : (
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "0.35rem",
              }}
            >
              Shareable Link:
            </label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <input
                type="text"
                readOnly
                value={effectiveShareUrl}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  fontSize: "0.8rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  backgroundColor: "var(--bg-accent, #f8fafc)",
                  color: "var(--text, #1e293b)",
                }}
              />
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  padding: "0.5rem 1rem",
                  backgroundColor: copied ? "#10b981" : "var(--accent-light, #2563eb)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "✓ Copied" : "Copy Link"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>
                Valid for {expiryHours} hours
              </span>
              <button
                type="button"
                onClick={() => {
                  setShareUrl("");
                  setShortUrl("");
                  setPreviewImage("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-light, #2563eb)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Revoke &amp; create new link
              </button>
            </div>
            {previewImage && (
              <div style={{ marginTop: "1rem" }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    marginBottom: "0.35rem",
                  }}
                >
                  Preview Image:
                </div>
                <img
                  src={previewImage}
                  alt={`Shareable preview for ${credential.credentialType || "credential"}`}
                  style={{
                    width: "100%",
                    borderRadius: "0.375rem",
                    border: "1px solid var(--border-input, #cbd5e1)",
                  }}
                />
              </div>
            )}
            <div style={{ marginTop: "1rem" }}>
              <SocialShare
                url={effectiveShareUrl}
                credential={credential}
                privacyMode={privacyMode}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialShare;
