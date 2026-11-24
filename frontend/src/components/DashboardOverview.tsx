import { useEffect, useState } from "react";
import { CredentialClient, IdentityClient, ReputationClient } from "../../../sdk/src/index";
import type { Credential, DidDocument, SorobanIdentityConfig } from "../../../sdk/src/types";
import AttestationCard from "./AttestationCard";
import RevocationModal from "./RevocationModal";
import SkeletonCard from "./SkeletonCard";
import { useToast } from "../context/ToastContext";

interface Props {
  address: string | null;
  config: SorobanIdentityConfig;
}

interface OnChainState {
  did: DidDocument | null;
  credentials: Credential[];
  reputation: number | null;
}

export default function DashboardOverview({ address, config }: Props) {
  const [state, setState] = useState<OnChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Credential | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!address) {
      setState(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const identity = new IdentityClient(config);
      const credentials = new CredentialClient(config);
      const reputation = new ReputationClient(config);
      const [did, creds, rep] = await Promise.allSettled([
        identity.resolveDid(address),
        credentials.getCredentialsBySubject(address, address),
        reputation.getReputation(address, address),
      ]);
      if (cancelled) return;
      setState({
        did: did.status === "fulfilled" ? did.value : null,
        credentials: creds.status === "fulfilled" ? creds.value : [],
        reputation:
          rep.status === "fulfilled" ? Number((rep.value as { score?: number }).score ?? 0) : null,
      });
      if ([did, creds, rep].every((r) => r.status === "rejected")) {
        setError("Failed to load on-chain identity state");
        showToast("Failed to load on-chain identity state", "error");
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [address, config, showToast]);

  const handleRevocation = async (cred: Credential, reason: string) => {
    try {
      // Revocation is executed by the issuer; here we record the subject's request.
      const key = "revocation-requests";
      const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
      existing.push({ credentialId: cred.id, issuer: cred.issuer, reason, requestedAt: Date.now() });
      localStorage.setItem(key, JSON.stringify(existing));
      showToast("Revocation request submitted", "success");
      setRevoking(null);
    } catch {
      showToast("Failed to submit revocation request", "error");
    }
  };

  if (!address) return <div className="card">Connect your wallet to view your on-chain identity.</div>;
  if (loading || !state) return <SkeletonCard />;

  return (
    <div className="dashboard-overview">
      {error && <div role="alert" className="card">{error}</div>}
      <div className="card">
        <h2>Identity overview</h2>
        <dl className="attestation-details">
          <dt>DID</dt>
          <dd>{state.did ? state.did.id : "No DID registered"}</dd>
          <dt>Status</dt>
          <dd>{state.did ? (state.did.active ? "Active" : "Deactivated") : "—"}</dd>
          <dt>Credentials</dt>
          <dd>{state.credentials.length}</dd>
          <dt>Reputation</dt>
          <dd>{state.reputation ?? "—"}</dd>
        </dl>
      </div>
      <div className="attestation-grid">
        {state.credentials.map((c) => (
          <AttestationCard key={c.id} credential={c} onRevoke={setRevoking} />
        ))}
      </div>
      {revoking && (
        <RevocationModal
          credential={revoking}
          onConfirm={handleRevocation}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
