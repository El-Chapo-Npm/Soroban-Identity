import type { Credential } from "../../../sdk/src/types";
import { formatAddress } from "../utils/formatAddress";
import { formatTimestamp } from "../utils/formatDate";

export type AttestationStatus = "verified" | "expired" | "revoked";

export function getAttestationStatus(cred: Credential, nowSec = Date.now() / 1000): AttestationStatus {
  if (cred.revoked) return "revoked";
  if (cred.expiresAt !== 0 && cred.expiresAt < nowSec) return "expired";
  return "verified";
}

const STATUS_BADGE: Record<AttestationStatus, string> = {
  verified: "badge-green",
  expired: "badge-gray",
  revoked: "badge-red",
};

interface Props {
  credential: Credential;
  onRevoke?: (credential: Credential) => void;
}

export default function AttestationCard({ credential, onRevoke }: Props) {
  const status = getAttestationStatus(credential);
  return (
    <div className="card attestation-card" data-testid="attestation-card">
      <div className="attestation-header">
        <span className="badge badge-purple">{credential.credentialType}</span>
        <span className={`badge ${STATUS_BADGE[status]}`}>{status}</span>
      </div>
      <dl className="attestation-details">
        <dt>Issuer</dt>
        <dd title={credential.issuer}>{formatAddress(credential.issuer)}</dd>
        <dt>Claim type</dt>
        <dd>{credential.credentialType}</dd>
        <dt>Expiry</dt>
        <dd>{credential.expiresAt === 0 ? "Never" : formatTimestamp(credential.expiresAt)}</dd>
      </dl>
      {onRevoke && status === "verified" && (
        <button className="btn-danger" onClick={() => onRevoke(credential)}>
          Request revocation
        </button>
      )}
    </div>
  );
}
