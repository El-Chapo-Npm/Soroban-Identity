export type ClaimStatus = 'verified' | 'pending';

/** Verified tick or pending icon shown next to a profile claim (#1353). */
export default function ClaimVerificationBadge({ status }: { status: ClaimStatus }) {
  const verified = status === 'verified';
  const label = verified ? 'Verified on-chain' : 'Pending on-chain verification';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        marginLeft: '0.4rem',
        fontWeight: 700,
        color: verified ? 'var(--success, #16a34a)' : 'var(--warning, #d97706)',
      }}
    >
      {verified ? '✓' : '⏳'}
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
