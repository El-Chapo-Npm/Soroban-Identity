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

/**
 * A claim is verified once the DID document is active and confirmed on-ledger
 * (has an on-chain update timestamp); anything else is still pending.
 */
export function getClaimStatus(doc: { active: boolean; updatedAt: number; createdAt: number }): ClaimStatus {
  return doc.active && (doc.updatedAt || doc.createdAt) > 0 ? 'verified' : 'pending';
}
