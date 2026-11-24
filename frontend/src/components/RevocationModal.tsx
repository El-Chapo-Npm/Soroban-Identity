import { useState } from "react";
import type { Credential } from "../../../sdk/src/types";

interface Props {
  credential: Credential;
  onConfirm: (credential: Credential, reason: string) => Promise<void>;
  onCancel: () => void;
}

export default function RevocationModal({ credential, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(credential, reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revocation-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="revocation-title">Request revocation</h2>
        <p>
          Request revocation of this <strong>{credential.credentialType}</strong> credential? The
          issuer will be notified and the action cannot be undone once processed.
        </p>
        <label htmlFor="revocation-reason">Reason (optional)</label>
        <textarea
          id="revocation-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={submitting}
        />
        <div className="modal-actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Submitting…" : "Confirm revocation"}
          </button>
        </div>
      </div>
    </div>
  );
}
