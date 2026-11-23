import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import type { CredentialType } from "../../../sdk/src/types";
import type { WalletState } from "../hooks/useWallet";

interface Props {
  wallet: WalletState & {
    connect: () => void;
    signTransaction: (xdr: string) => Promise<string>;
  };
}

type VerifyState =
  | "idle"
  | "valid"
  | "not_found"
  | "revoked"
  | "expired"
  | "invalid";

type FilterType = "All" | CredentialType;

interface Attestation {
  id: string;
  credentialType: CredentialType;
  subject: string;
}

interface Page<T> {
  items: T[];
  total: number;
}

const PAGE_SIZE = 5;
const TYPES: CredentialType[] = ["Kyc", "Reputation", "Achievement", "Custom"];

// Mock dataset — replace with SDK data when wired
const MOCK_CREDENTIALS: Attestation[] = Array.from({ length: 23 }, (_, i) => ({
  id: `abc${String(i + 1).padStart(3, "0")}`,
  credentialType: TYPES[i % TYPES.length],
  subject: "GABC…",
}));

// Simulates a server-side paginated query: the server filters and slices, the client only holds one page.
async function fetchAttestations(type: FilterType, page: number, pageSize: number): Promise<Page<Attestation>> {
  // TODO: wire CredentialClient paginated query from SDK
  await new Promise((r) => setTimeout(r, 300));
  const all = type === "All" ? MOCK_CREDENTIALS : MOCK_CREDENTIALS.filter((c) => c.credentialType === type);
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total: all.length };
}

const FILTER_OPTIONS: FilterType[] = ["All", "Kyc", "Reputation", "Achievement", "Custom"];

function countByType(type: FilterType): number {
  if (type === "All") return MOCK_CREDENTIALS.length;
  return MOCK_CREDENTIALS.filter((c) => c.credentialType === type).length;
}

export default function CredentialsPanel({ wallet }: Props) {
  const [credId, setCredId] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifying, setVerifying] = useState(false);

  const [subject, setSubject] = useState("");
  const [issueResult, setIssueResult] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<Page<Attestation>>({ items: [], total: 0 });
  const [loadingPage, setLoadingPage] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));

  const loadPage = useCallback(async () => {
    setLoadingPage(true);
    try {
      setPageData(await fetchAttestations(activeFilter, page, PAGE_SIZE));
    } finally {
      setLoadingPage(false);
    }
  }, [activeFilter, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const handleRevoke = async () => {
    const id = revokeTarget;
    setRevokeTarget(null);
    if (!id) return;
    // TODO: build revoke tx via CredentialClient, sign via wallet.signTransaction(), submit
    await new Promise((r) => setTimeout(r, 500));
    const idx = MOCK_CREDENTIALS.findIndex((c) => c.id === id);
    if (idx !== -1) MOCK_CREDENTIALS.splice(idx, 1);
    if (pageData.items.length === 1 && page > 1) setPage(page - 1);
    else loadPage();
  };

  const handleVerify = async () => {
    if (!credId.trim()) return;
    setVerifying(true);
    setVerifyState("idle");
    try {
      // TODO: wire CredentialClient.verifyCredential() from SDK
      await new Promise((r) => setTimeout(r, 800));
      const mockResult = credId.startsWith("0")
        ? { valid: false as const, reason: "revoked" as const }
        : { valid: true as const };
      if (mockResult.valid) {
        setVerifyState("valid");
      } else {
        setVerifyState(mockResult.reason);
      }
    } catch {
      setVerifyState("invalid");
    } finally {
      setVerifying(false);
    }
  };

  const handleIssue = async () => {
    if (!wallet.connected || !subject.trim()) return;
    setIssuing(true);
    setIssueResult(null);
    try {
      // TODO: build tx via CredentialClient, sign via wallet.signTransaction(), submit
      await new Promise((r) => setTimeout(r, 1000));
      const mockId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setIssueResult(`Credential issued.\nID: ${mockId}`);
    } catch (e: unknown) {
      setIssueResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
      {/* Filter bar */}
      <div className="card">
        <h2>Credentials</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {FILTER_OPTIONS.map((type) => {
            const count = countByType(type);
            const isActive = activeFilter === type;
            return (
              <button
                key={type}
                onClick={() => {
                  setActiveFilter(type);
                  setPage(1);
                }}
                style={{
                  padding: "0.3rem 0.75rem",
                  borderRadius: "999px",
                  border: isActive ? "2px solid var(--accent-light)" : "2px solid var(--border-input)",
                  background: isActive ? "var(--card-bg-accent)" : "transparent",
                  color: isActive ? "var(--accent-light)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: isActive ? 600 : 400,
                }}
                aria-pressed={isActive}
              >
                {type}{" "}
                <span
                  style={{
                    background: isActive ? "var(--filter-badge-active-bg)" : "var(--border-input)",
                    color: isActive ? "var(--filter-badge-active-text)" : "var(--text-muted)",
                    borderRadius: "999px",
                    padding: "0 0.4rem",
                    fontSize: "0.75rem",
                    marginLeft: "0.25rem",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loadingPage && pageData.items.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading…</p>
        ) : pageData.items.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No {activeFilter} credentials found.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {pageData.items.map((cred) => (
              <li
                key={cred.id}
                style={{
                  background: "var(--cred-item-bg)",
                  borderRadius: "0.5rem",
                  padding: "0.6rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.85rem",
                  color: "var(--text)",
                }}
              >
                <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{cred.id}</span>
                <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span className="badge badge-green">{cred.credentialType}</span>
                  {wallet.connected && (
                    <button
                      className="btn-danger"
                      style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }}
                      onClick={() => setRevokeTarget(cred.id)}
                    >
                      Revoke
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {pageData.total > PAGE_SIZE && (
          <div className="pagination">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loadingPage}>
              ← Prev
            </button>
            <span>
              Page {page} of {totalPages} · {pageData.total} total
            </span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || loadingPage}>
              Next →
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Verify Credential</h2>
        <input
          placeholder="Credential ID (hex)"
          value={credId}
          onChange={(e) => setCredId(e.target.value)}
        />
        <button onClick={handleVerify} disabled={verifying || !credId}>
          {verifying ? "Verifying…" : "Verify"}
        </button>
        {verifyState !== "idle" && (
          <div style={{ marginTop: "1rem" }}>
            {verifyState === "valid" && (
              <span className="badge badge-green">Valid</span>
            )}
            {verifyState === "revoked" && (
              <span className="badge badge-red">Invalid — credential has been revoked</span>
            )}
            {verifyState === "expired" && (
              <span className="badge badge-red">Invalid — credential has expired</span>
            )}
            {verifyState === "not_found" && (
              <span className="badge badge-red">Invalid — credential not found</span>
            )}
            {(verifyState === "invalid" || verifyState === "unknown" as string) && (
              <span className="badge badge-red">Invalid</span>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Issue Credential</h2>
        {wallet.connected ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              Issuing as{" "}
              <span style={{ color: "var(--accent-light)" }}>
                {wallet.publicKey?.slice(0, 6)}…{wallet.publicKey?.slice(-4)}
              </span>
            </p>
            <input
              placeholder="Subject address (G…)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <button onClick={handleIssue} disabled={issuing || !subject}>
              {issuing ? "Issuing…" : "Issue KYC Credential"}
            </button>
          </>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Connect your Freighter wallet to issue credentials as a registered issuer.
          </p>
        )}
        {issueResult && <pre className="result">{issueResult}</pre>}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke attestation?"
        message={`Attestation ${revokeTarget ?? ""} will be permanently revoked. This action cannot be undone.`}
        confirmLabel="Revoke"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
