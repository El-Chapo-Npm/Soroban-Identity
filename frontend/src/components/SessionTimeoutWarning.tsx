interface SessionTimeoutWarningProps {
  open: boolean;
  secondsRemaining: number;
  onExtend: () => void;
  onDisconnect: () => void;
}

export default function SessionTimeoutWarning({
  open,
  secondsRemaining,
  onExtend,
  onDisconnect,
}: SessionTimeoutWarningProps) {
  if (!open) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeLabel = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session timeout warning"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: "1rem",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(100%, 28rem)",
          margin: 0,
          padding: "1.25rem",
          boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.2rem" }}>
          Session expiring soon
        </h2>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          You will be disconnected in <strong>{timeLabel}</strong> due to inactivity.
          Extend your session to stay connected.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn-secondary" onClick={onDisconnect}>
            Disconnect now
          </button>
          <button type="button" className="btn-primary" onClick={onExtend}>
            Extend session
          </button>
        </div>
      </div>
    </div>
  );
}
