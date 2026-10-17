import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceCommands, type UseVoiceCommandsResult } from "../hooks/useVoiceCommands";

export interface VoiceCommandButtonProps {
  voice?: UseVoiceCommandsResult;
  className?: string;
}

export default function VoiceCommandButton({
  voice: externalVoice,
  className = "",
}: VoiceCommandButtonProps) {
  const { t } = useTranslation();
  const internalVoice = useVoiceCommands({});
  const voice = externalVoice ?? internalVoice;
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = async () => {
    if (!voice.isSupported) return;
    if (voice.permissionState === "denied") {
      alert(t("voice.permissionDenied", "Microphone access is denied. Please allow microphone permissions in your browser."));
      return;
    }
    await voice.toggle();
  };

  const title = !voice.isSupported
    ? t("voice.unsupported", "Voice commands not supported in this browser")
    : voice.isListening
    ? t("voice.listening", "Listening... Click to stop")
    : t("voice.start", "Voice commands (click to start)");

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={!voice.isSupported}
        aria-label={title}
        aria-pressed={voice.isListening}
        className={`voice-command-button ${voice.isListening ? "listening" : ""} ${className}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.35rem",
          padding: "0.45rem 0.75rem",
          borderRadius: "0.375rem",
          border: voice.isListening
            ? "1px solid #ef4444"
            : "1px solid var(--border-color, #334155)",
          background: voice.isListening
            ? "rgba(239, 68, 68, 0.15)"
            : "var(--bg-secondary, #1e293b)",
          color: voice.isListening ? "#ef4444" : "var(--text-color, #f1f5f9)",
          cursor: voice.isSupported ? "pointer" : "not-allowed",
          fontSize: "0.85rem",
          fontWeight: 500,
          opacity: voice.isSupported ? 1 : 0.6,
          transition: "all 0.15s ease",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: voice.isListening ? "scale(1.15)" : "none",
            transition: "transform 0.15s ease",
          }}
          aria-hidden="true"
        >
          {voice.isListening ? "🔴" : "🎤"}
        </span>
        <span>{voice.isListening ? t("voice.active", "Listening…") : t("voice.button", "Voice")}</span>
      </button>

      {/* Interim transcript feedback badge */}
      {voice.isListening && voice.interimTranscript && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "0.35rem",
            padding: "0.35rem 0.6rem",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #ef4444",
            borderRadius: "0.375rem",
            fontSize: "0.75rem",
            color: "#f8fafc",
            whiteSpace: "nowrap",
            zIndex: 100,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
          }}
        >
          "{voice.interimTranscript}"
        </div>
      )}

      {/* Tooltip on hover when idle */}
      {showTooltip && !voice.isListening && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "0.35rem",
            padding: "0.35rem 0.6rem",
            background: "#1e293b",
            border: "1px solid #475569",
            borderRadius: "0.375rem",
            fontSize: "0.75rem",
            color: "#cbd5e1",
            whiteSpace: "nowrap",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          {title}
        </div>
      )}
    </div>
  );
}
