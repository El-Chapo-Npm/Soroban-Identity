import { useMemo, useState, type FormEvent } from "react";
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { getNetworkConfig } from "../network";
import { useWalletContext } from "../context/WalletContext";
import { useSorobanInvoke } from "../hooks/useSorobanInvoke";
import { useToast } from "../context/ToastContext";
import { handleError } from "../utils/handleError";

interface ClaimSubmissionFormProps {
  onSubmitted?: (credentialId: string) => void;
}

const CLAIM_TYPES = ["Kyc", "Reputation", "Achievement", "Custom"] as const;
const MAX_EVIDENCE_BYTES = 1024 * 1024; // 1MB UI guard

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function ClaimSubmissionForm({ onSubmitted }: ClaimSubmissionFormProps) {
  const wallet = useWalletContext();
  const toast = useToast();
  const invokeContract = useSorobanInvoke();
  const [claimType, setClaimType] = useState<(typeof CLAIM_TYPES)[number]>("Kyc");
  const [claimValue, setClaimValue] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceHash, setEvidenceHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => wallet.connected && !!wallet.publicKey && claimValue.trim().length > 0 && !submitting,
    [claimValue, submitting, wallet.connected, wallet.publicKey]
  );

  const onEvidenceChange = async (file: File | null) => {
    setEvidenceFile(file);
    setEvidenceHash(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_EVIDENCE_BYTES) {
      setError("Evidence file is too large. Please upload a file 1MB or smaller.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    setEvidenceHash(toHex(new Uint8Array(digest)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet.connected || !wallet.publicKey) {
      setError("Connect your wallet to submit a claim.");
      return;
    }
    if (!claimValue.trim()) {
      setError("Claim value is required.");
      return;
    }
    if (evidenceFile && !evidenceHash) {
      setError("Evidence is still processing. Please wait a moment.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const networkConfig = getNetworkConfig();
      const claimsMap: Record<string, string> = {
        claim_type: claimType,
        claim_value: claimValue.trim(),
      };
      if (evidenceFile && evidenceHash) {
        claimsMap.evidence_name = evidenceFile.name;
        claimsMap.evidence_size = String(evidenceFile.size);
        claimsMap.evidence_sha256 = evidenceHash;
      }

      // Reuse existing contract flow: issue a self-attested credential carrying
      // the claim payload and evidence hash. This avoids guessing contract methods
      // that may not exist in the deployed IdentityManager.
      const claimsHashHex = evidenceHash
        ? evidenceHash.padEnd(64, "0").slice(0, 64)
        : "0000000000000000000000000000000000000000000000000000000000000000";
      const sigHex = "0".repeat(128);

      const { returnValue } = await invokeContract({
        contractId: networkConfig.credentialManagerId,
        method: "issue_credential",
        args: [
          nativeToScVal(wallet.publicKey, { type: "address" }),
          nativeToScVal(wallet.publicKey, { type: "address" }),
          nativeToScVal(claimType, { type: "symbol" }),
          nativeToScVal(claimsMap, { type: "map" }),
          nativeToScVal(Uint8Array.from(claimsHashHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))), { type: "bytes" }),
          nativeToScVal(Uint8Array.from(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))), { type: "bytes" }),
          nativeToScVal(BigInt(0), { type: "u64" }),
        ],
      });

      const raw = scValToNative(returnValue as any) as Uint8Array;
      const credentialId = toHex(new Uint8Array(raw));
      toast.success("Claim submitted successfully.");
      setClaimValue("");
      setEvidenceFile(null);
      setEvidenceHash(null);
      onSubmitted?.(credentialId);
    } catch (err) {
      const message = handleError(err);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>Submit Claim</h2>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
        Submit a new claim with a type, value, and optional evidence file. Evidence is hashed locally and the hash is included in the claim payload.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="claim-type">Claim type</label>
          <select
            id="claim-type"
            value={claimType}
            onChange={(e) => setClaimType(e.target.value as (typeof CLAIM_TYPES)[number])}
            disabled={submitting}
          >
            {CLAIM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="claim-value">Claim value</label>
          <input
            id="claim-value"
            type="text"
            value={claimValue}
            onChange={(e) => setClaimValue(e.target.value)}
            placeholder="e.g. Email verified, GitHub contributor, etc."
            maxLength={256}
            disabled={submitting}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="claim-evidence">Evidence upload (optional)</label>
          <input
            id="claim-evidence"
            type="file"
            onChange={(e) => void onEvidenceChange(e.target.files?.[0] ?? null)}
            disabled={submitting}
          />
          {evidenceFile && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {evidenceFile.name} ({Math.ceil(evidenceFile.size / 1024)} KB)
              {evidenceHash ? " - hash ready" : " - hashing..."}
            </p>
          )}
        </div>

        {error && (
          <div className="error" role="alert" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {submitting ? "Submitting..." : "Submit Claim"}
        </button>
      </form>
    </div>
  );
}
