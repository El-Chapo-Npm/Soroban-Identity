import { useEffect, useState } from "react";
import type { DidDocument } from "../../../sdk/src/types";
import { IdentityClient } from "../../../sdk/src";
import { getNetworkConfig } from "../network";
import { fetchClaimStatuses, type ClaimStatus } from "../utils/identityApi";
import ClaimVerificationBadge from "./ClaimVerificationBadge";

/** Public page rendered at `/verify/:did` for third parties to check attestation status (#1356). */
export default function IdentityVerifyPage({ did }: { did: string }) {
  const [doc, setDoc] = useState<DidDocument | null>(null);
  const [claims, setClaims] = useState<Record<string, ClaimStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const address = did.replace(/^did:stellar:/, "");
    setLoading(true);
    new IdentityClient(getNetworkConfig())
      .resolveDid(address)
      .then((d) => !cancelled && setDoc(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not resolve DID"))
      .finally(() => !cancelled && setLoading(false));
    fetchClaimStatuses(did)
      .then((c) => !cancelled && setClaims(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [did]);

  return (
    <main id="main-content" className="card" style={{ maxWidth: 640, margin: "2rem auto", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.4rem" }}>Identity verification</h1>
      <p style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{did}</p>
      {loading && <p aria-busy="true">Checking attestation status…</p>}
      {error && <p role="alert" style={{ color: "var(--error, #dc2626)" }}>{error}</p>}
      {doc && (
        <>
          <p role="status">
            Status:{" "}
            <strong style={{ color: doc.active ? "var(--success, #16a34a)" : "var(--error, #dc2626)" }}>
              {doc.active ? "Active" : "Deactivated"}
            </strong>
          </p>
          <h2 style={{ fontSize: "1.1rem" }}>Claims</h2>
          {Object.keys(doc.metadata ?? {}).length === 0 ? (
            <p>No claims published.</p>
          ) : (
            <ul>
              {Object.entries(doc.metadata).map(([key, value]) => (
                <li key={key}>
                  <strong>{key}:</strong> {String(value)}
                  <ClaimVerificationBadge status={claims[key] ?? "pending"} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p><a href="/">Open Soroban Identity</a></p>
    </main>
  );
}
