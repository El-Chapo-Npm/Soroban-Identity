import type { ClaimStatus } from "../utils/identityApi";

const LABELS: Record<ClaimStatus, { icon: string; text: string; color: string }> = {
  verified: { icon: "✓", text: "Verified on-chain", color: "var(--success, #16a34a)" },
  pending: { icon: "⏳", text: "Verification pending", color: "var(--warning, #d97706)" },
  unverified: { icon: "?", text: "Not verified", color: "var(--text-muted, #64748b)" },
};

/** Verified tick / pending icon shown next to a profile claim (#1353). */
export default function ClaimVerificationBadge({ status }: { status: ClaimStatus }) {
  const { icon, text, color } = LABELS[status] ?? LABELS.unverified;
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-status={status}
      style={{ marginLeft: "0.4rem", color, fontWeight: 700, fontSize: "0.85em" }}
    >
      {icon}
    </span>
  );
}
