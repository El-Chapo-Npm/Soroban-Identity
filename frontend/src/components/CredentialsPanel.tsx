import { useState, useEffect, useReducer, useRef } from "react";
import { StrKey, SorobanRpc, TransactionBuilder, BASE_FEE, nativeToScVal, Contract, scValToNative } from '@stellar/stellar-sdk';
import type { CredentialType, Credential, VerifyResult } from "../../../sdk/src/types";
import { CredentialClient } from '../../../sdk/src';
import { validateStellarAddress } from "../../../sdk/src/utils";
import { getNetworkConfig } from '../network';
import SkeletonCard from "./SkeletonCard";
import FormField from "./FormField";
import CredentialImport from "./CredentialImport";
import { formatTimestamp } from "../utils/formatDate";
import { handleError } from "../utils/handleError";
import { useWalletContext } from "../context/WalletContext";
import { useToast } from "../context/ToastContext";
import CredentialTimeline from "./CredentialTimeline";

type VerifyState =
  | "idle"
  | "valid"
  | "not_found"
  | "revoked"
  | "expired"
  | "invalid"
  | "unknown";

type FilterType = "All" | CredentialType;
type ExpiryFilterType = "All" | "Active" | "Expired";
type CredentialStatus = "active" | "expired" | "revoked";

function formatExpiry(expiresAt: number): string {
  if (expiresAt === 0) return "No expiry";

  const now = Date.now();
  const expiryMs = expiresAt * 1000;
  const diffMs = expiryMs - now;
  const diffDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const diffMinutes = Math.floor(Math.abs(diffMs) / (1000 * 60));

  if (diffMs < 0) {
    if (diffDays > 0) return `Expired ${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    if (diffHours > 0) return `Expired ${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return `Expired ${diffMinutes} min${diffMinutes > 1 ? "s" : ""} ago`;
  }

  if (diffDays > 0) return `Expires in ${diffDays} day${diffDays > 1 ? "s" : ""}`;
  if (diffHours > 0) return `Expires in ${diffHours} hour${diffHours > 1 ? "s" : ""}`;
  return `Expires in ${diffMinutes} min${diffMinutes > 1 ? "s" : ""}`;
}

function getExpiryStyle(expiresAt: number): React.CSSProperties {
  if (expiresAt === 0) return { color: "var(--text-muted)" };

  const now = Date.now();
  const expiryMs = expiresAt * 1000;
  const diffMs = expiryMs - now;
  const diffDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return { color: "var(--error)", fontWeight: 600 };
  }
  if (diffDays <= 7) {
    return { color: "var(--warning)", fontWeight: 600 };
  }
  return { color: "var(--text-muted)" };
}

function isExpired(expiresAt: number): boolean {
  return expiresAt > 0 && Date.now() / 1000 > expiresAt;
}

function getCredentialStatus(credential: Credential): CredentialStatus {
  if (credential.revoked) return "revoked";
  if (isExpired(credential.expiresAt)) return "expired";
  return "active";
}

function getStatusBadgeClass(status: CredentialStatus): string {
  if (status === "revoked") return "badge badge-red";
  if (status === "expired") return "badge badge-yellow";
  return "badge badge-green";
}

function getStatusLabel(status: CredentialStatus): string {
  if (status === "revoked") return "Revoked";
  if (status === "expired") return "Expired";
  return "Active";
}

function getStatusTooltip(credential: Credential, status: CredentialStatus): string {
  if (status === "revoked") return "This credential has been revoked by the issuer and is no longer valid.";
  if (status === "expired") return `This credential expired on ${formatTimestamp(credential.expiresAt)}.`;
  return credential.expiresAt === 0
    ? "This credential is valid and does not expire."
    : `This credential is valid until ${formatTimestamp(credential.expiresAt)}.`;
}

const STATUS_REFRESH_INTERVAL_MS = 30_000;

function formatCheckedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function getStatusSortRank(credential: Credential): number {
  const status = getCredentialStatus(credential);
  if (status === "active") return 0;
  if (status === "expired") return 1;
  return 2;
}

// TODO: integrate SDK — replace with CredentialClient.getCredentialsBySubject() (see issue #226)

const FILTER_OPTIONS: FilterType[] = ["All", "Kyc", "Reputation", "Achievement", "Custom"];
const EXPIRY_FILTER_OPTIONS: ExpiryFilterType[] = ["All", "Active", "Expired"];

const CREDENTIAL_TYPE_ICONS: Record<CredentialType, string> = {
  Kyc: "🆔",
  Reputation: "⭐",
  Achievement: "🏆",
  Custom: "📋",
};

function countByType(creds: Credential[], type: FilterType): number {
  if (type === "All") return creds.length;
  return creds.filter((c) => c.credentialType === type).length;
}

function countByExpiry(creds: Credential[], filter: ExpiryFilterType): number {
  if (filter === "All") return creds.length;
  if (filter === "Active") return creds.filter((c) => !isExpired(c.expiresAt) && !c.revoked).length;
  if (filter === "Expired") return creds.filter((c) => isExpired(c.expiresAt) || c.revoked).length;
  return creds.length;
}

function CredentialEmptyState({ searchedAddress }: { searchedAddress: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        minHeight: "12rem",
        padding: "2.5rem 1rem",
        textAlign: "center",
        color: "var(--text-muted)",
      }}
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="10"
          y="8"
          width="36"
          height="40"
          rx="8"
          fill="var(--card-bg-accent)"
          stroke="var(--border-input)"
          strokeWidth="2"
        />
        <path
          d="M19 23h18M19 31h12"
          stroke="var(--accent-light)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle
          cx="38"
          cy="38"
          r="7"
          fill="var(--card-bg)"
          stroke="var(--accent-light)"
          strokeWidth="2"
        />
        <path
          d="m35.5 38 1.8 1.8 3.7-4"
          stroke="var(--accent-light)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <h3 style={{ margin: "0 0 0.35rem", color: "var(--text)", fontSize: "1rem" }}>
          No credentials yet
        </h3>
        <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5 }}>
          Credentials issued to your DID will appear here.
        </p>
        {searchedAddress && (
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", lineHeight: 1.4 }}>
            Searched account {searchedAddress.slice(0, 6)}...{searchedAddress.slice(-4)}
          </p>
        )}
      </div>
    </div>
  );
}

type CredentialState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; credentials: Credential[]; searchedAddress: string }
  | { status: 'error'; message: string };

type CredentialAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; credentials: Credential[]; searchedAddress: string }
  | { type: 'FETCH_ERROR'; message: string }
  | { type: 'RESET' };

function credentialReducer(_state: CredentialState, action: CredentialAction): CredentialState {
  switch (action.type) {
    case 'FETCH_START': return { status: 'loading' };
    case 'FETCH_SUCCESS': return { status: 'success', credentials: action.credentials, searchedAddress: action.searchedAddress };
    case 'FETCH_ERROR': return { status: 'error', message: action.message };
    case 'RESET': return { status: 'idle' };
  }
}

export default function CredentialsPanel({ verifyId }: { verifyId?: string | null }) {
  const wallet = useWalletContext();
  const toast = useToast();
  const [credentialState, dispatchCredential] = useReducer(credentialReducer, { status: 'idle' });

  const fetchedCredentials = credentialState.status === 'success' ? credentialState.credentials : null;
  const fetching = credentialState.status === 'loading';
  const searchedAddress = credentialState.status === 'success' ? credentialState.searchedAddress : null;

  const [credId, setCredId] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifying, setVerifying] = useState(false);
  const [expandedCredId, setExpandedCredId] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [claims, setClaims] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [expiresAt, setExpiresAt] = useState("0");
  const [issueResult, setIssueResult] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueErrors, setIssueErrors] = useState<Record<string, string>>({});

  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [activeExpiryFilter, setActiveExpiryFilter] = useState<ExpiryFilterType>("All");
  const [isIssuer, setIsIssuer] = useState(false);
  const [checkingIssuer, setCheckingIssuer] = useState(false);

  const [searchAddress, setSearchAddress] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [verifyCheckedAt, setVerifyCheckedAt] = useState<number | null>(null);

  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv" | "pdf">("json");
  const [isExporting, setIsExporting] = useState(false);
  const [selectedCredentialsForExport, setSelectedCredentialsForExport] = useState<Set<string>>(new Set());

  const handleVerify = async (credentialId?: string, silent = false) => {
  // ── Pagination ──────────────────────────────────────────────────────────
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
  const readIntParam = (name: string, fallback: number): number => {
    const raw = new URLSearchParams(window.location.search).get(name);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const [page, setPage] = useState(() => readIntParam("page", 1));
  const [pageSize, setPageSize] = useState(() => {
    const fromUrl = readIntParam("pageSize", 10);
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(fromUrl) ? fromUrl : 10;
  });

  const updatePaginationParams = (nextPage: number, nextPageSize: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(nextPage));
    url.searchParams.set("pageSize", String(nextPageSize));
    window.history.replaceState({}, "", url);
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    updatePaginationParams(nextPage, pageSize);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
    updatePaginationParams(1, nextPageSize);
  };

  // Reused across calls instead of instantiating a fresh CredentialClient (and its
  // own RequestQueue + health check) on every verify/search/issuer-check — see #612.
  const credentialClientRef = useRef<CredentialClient | null>(null);
  const getCredentialClient = () => {
    if (!credentialClientRef.current) {
      credentialClientRef.current = new CredentialClient(getNetworkConfig());
    }
    return credentialClientRef.current;
  };
  useEffect(() => {
    return () => {
      credentialClientRef.current?.dispose();
      credentialClientRef.current = null;
    };
  }, []);

  const handleVerify = async (credentialId?: string) => {
    if (verifying) return; // guard against duplicate submissions
    const id = (credentialId ?? credId).trim();
    if (!id) return;
    if (!silent) {
      setVerifying(true);
      setVerifyState("idle");
    }
    try {
      const credentialClient = getCredentialClient();
      const caller = wallet.publicKey || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const result = await credentialClient.verifyCredential(caller, id);
      setVerifyState(result.valid ? "valid" : result.reason || "invalid");
      setVerifyCheckedAt(Date.now());
      const reason = result.reason;
      const knownReason: VerifyState =
        reason === "not_found" || reason === "revoked" || reason === "expired" || reason === "unknown"
          ? reason
          : "invalid";
      setVerifyState(result.valid ? "valid" : knownReason);
      if (result.valid) {
        toast.success("Credential is valid.");
      } else {
        toast.error(`Credential is invalid (${knownReason.replace("_", " ")}).`);
      }
    } catch (e: unknown) {
      setVerifyState("invalid");
      setVerifyCheckedAt(Date.now());
      toast.error(handleError(e));
    } finally {
      if (!silent) setVerifying(false);
    }
  };

  // Check if connected wallet is a registered issuer
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) {
      setIsIssuer(false);
      return;
    }

    const checkIssuerStatus = async () => {
      setCheckingIssuer(true);
      try {
        const credentialClient = getCredentialClient();
        const caller = wallet.publicKey || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
        const issuer = await credentialClient.isIssuer(caller, wallet.publicKey!);
        setIsIssuer(issuer);
      } catch {
        setIsIssuer(false);
      } finally {
        setCheckingIssuer(false);
      }
    };

    checkIssuerStatus();
  }, [wallet.connected, wallet.publicKey]);

  // Handle deep link verification
  useEffect(() => {
    if (!verifyId) return;
    setCredId(verifyId);
    void handleVerify(verifyId);
  }, [verifyId]);

  // Auto-refresh the verification result so a revoke/expiry elsewhere is reflected here
  useEffect(() => {
    if (verifyState === "idle" || !credId) return;
    const interval = setInterval(() => {
      void handleVerify(credId, true);
    }, STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [verifyState, credId]);

  const fetchCredentialsForAddress = async (addr: string) => {
  const handleSearch = async () => {
    if (fetching) return; // guard against duplicate submissions
    const addr = searchAddress.trim();
    if (!addr) return;

    // Validate Stellar address format
    if (!StrKey.isValidEd25519PublicKey(addr)) {
      const message = 'Invalid Stellar address format. Address must start with "G" and be 56 characters long.';
      dispatchCredential({ type: 'FETCH_ERROR', message });
      toast.error(message);
      return;
    }

    dispatchCredential({ type: 'FETCH_START' });
    goToPage(1);
    try {
      const credentialClient = getCredentialClient();
      const caller = wallet.publicKey || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const results = await credentialClient.getCredentialsBySubject(caller, addr);
      dispatchCredential({ type: 'FETCH_SUCCESS', credentials: results, searchedAddress: addr });
      setLastCheckedAt(Date.now());
    } catch (e: unknown) {
      const message = handleError(e);
      dispatchCredential({ type: 'FETCH_ERROR', message });
      toast.error(message);
    }
  };

  const handleSearch = async () => {
    const addr = searchAddress.trim();
    if (!addr) return;

    // Validate Stellar address format
    if (!StrKey.isValidEd25519PublicKey(addr)) {
      dispatchCredential({
        type: 'FETCH_ERROR',
        message: 'Invalid Stellar address format. Address must start with "G" and be 56 characters long.'
      });
      return;
    }

    await fetchCredentialsForAddress(addr);
  };

  // Auto-refresh the credential list periodically so status changes (revoke/expiry) show up
  useEffect(() => {
    if (!searchedAddress) return;
    const interval = setInterval(() => {
      void fetchCredentialsForAddress(searchedAddress);
    }, STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [searchedAddress]);

  const validateIssueForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Validate subject address
    if (!subject.trim()) {
      errors.subject = "Subject address is required";
    } else if (!StrKey.isValidEd25519PublicKey(subject.trim())) {
      errors.subject = "Invalid Stellar address format. Address must start with 'G' and be 56 characters long.";
    }

    // Validate at least one claim
    const filledClaims = claims.filter((c) => c.key.trim() || c.value.trim());
    if (filledClaims.length === 0) {
      errors.claims = "At least one claim key-value pair is required";
    }

    // Validate expiry date
    const expiryNum = parseInt(expiresAt, 10);
    if (isNaN(expiryNum) || expiryNum < 0) {
      errors.expiresAt = "Expiry must be 0 or a positive number";
    } else if (expiryNum > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (expiryNum <= now) {
        errors.expiresAt = "Expiry date must be in the future";
      }
    }

    setIssueErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddClaim = () => {
    setClaims([...claims, { key: "", value: "" }]);
  };

  const handleRemoveClaim = (index: number) => {
    setClaims(claims.filter((_, i) => i !== index));
  };

  const handleClaimChange = (index: number, field: "key" | "value", value: string) => {
    const updated = [...claims];
    updated[index][field] = value;
    setClaims(updated);
  };

  const handleExport = async (format: "json" | "csv" | "pdf") => {
    try {
      setIsExporting(true);
      const credentialsToExport =
        selectedCredentialsForExport.size > 0
          ? sortedCredentials.filter((c) => selectedCredentialsForExport.has(c.id))
          : sortedCredentials;

      if (credentialsToExport.length === 0) {
        toast.error("No credentials to export");
        return;
      }

      const result = await exportCredentialsWithProgress(credentialsToExport, format);
      downloadExport(result.content, result.filename, result.mimeType);
      toast.success(`Successfully exported ${credentialsToExport.length} credentials as ${format.toUpperCase()}`);
      setSelectedCredentialsForExport(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportCredentials = (credentials: Credential[]) => {
    toast.success(`Imported ${credentials.length} credentials`);
  };

  const toggleCredentialSelection = (credentialId: string) => {
    const newSet = new Set(selectedCredentialsForExport);
    if (newSet.has(credentialId)) {
      newSet.delete(credentialId);
    } else {
      newSet.add(credentialId);
    }
    setSelectedCredentialsForExport(newSet);
  };

  const displayCredentials = fetchedCredentials ?? [];

  const filteredCredentials =
    activeFilter === "All"
      ? displayCredentials
      : displayCredentials.filter((c) => c.credentialType === activeFilter);

  const filteredByExpiry = filteredCredentials.filter((c) => {
    if (activeExpiryFilter === "All") return true;
    if (activeExpiryFilter === "Active") return !isExpired(c.expiresAt) && !c.revoked;
    if (activeExpiryFilter === "Expired") return isExpired(c.expiresAt) || c.revoked;
    return true;
  });

  const sortedCredentials = [...filteredByExpiry].sort(
    (a, b) => getStatusSortRank(a) - getStatusSortRank(b)
  );

  const totalCredentials = sortedCredentials.length;
  const totalPages = Math.max(1, Math.ceil(totalCredentials / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageStart = (clampedPage - 1) * pageSize;
  const pagedCredentials = sortedCredentials.slice(pageStart, pageStart + pageSize);

  // Reset to page 1 whenever the active filters change the result set shape.
  // We do this synchronously in the click handler (not via useEffect) so the
  // corrected page number is applied in the same render cycle and there is
  // never a frame showing an empty page. Fixes #734.
  const handleFilterChange = (type: FilterType) => {
    setActiveFilter(type);
    setPage(1);
    updatePaginationParams(1, pageSize);
  };

  const handleExpiryFilterChange = (status: ExpiryFilterType) => {
    setActiveExpiryFilter(status);
    setPage(1);
    updatePaginationParams(1, pageSize);
  };

  const handleIssue = async () => {
    if (issuing) return; // guard against duplicate submissions
    if (!wallet.connected || !wallet.publicKey) return;

    if (!validateIssueForm()) return;

    setIssuing(true);
    setIssueResult(null);
    try {
      const networkConfig = getNetworkConfig();
      const server = new SorobanRpc.Server(typeof networkConfig.rpcUrl === 'string' ? networkConfig.rpcUrl : networkConfig.rpcUrl[0]);
      const contract = new Contract(networkConfig.credentialManagerId);
      const account = await server.getAccount(wallet.publicKey);
      
      const claimsMap = claims.reduce((acc, { key, value }) => {
        if (key.trim() && value.trim()) acc[key.trim()] = value.trim();
        return acc;
      }, {} as Record<string, string>);
      
      const claimsHashHex = "0000000000000000000000000000000000000000000000000000000000000000";
      const sigHex = Buffer.alloc(64, 0).toString("hex");

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: networkConfig.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "issue_credential",
            nativeToScVal(wallet.publicKey, { type: "address" }),
            nativeToScVal(subject.trim(), { type: "address" }),
            nativeToScVal("Kyc", { type: "symbol" }),
            nativeToScVal(claimsMap, { type: "map" }),
            nativeToScVal(Buffer.from(claimsHashHex, "hex"), { type: "bytes" }),
            nativeToScVal(Buffer.from(sigHex, "hex"), { type: "bytes" }),
            nativeToScVal(parseInt(expiresAt || "0", 10), { type: "u64" })
          )
        )
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      const estimatedFee = parseInt(prepared.fee, 10);
      const signedXdr = await wallet.signTransaction(prepared.toXDR());
      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkConfig.networkPassphrase);
      const result = await server.sendTransaction(signedTx as any);
      
      if (result.status !== "PENDING") throw new Error(`Transaction failed: ${result.status}`);
      
      let txStatus = await server.getTransaction(result.hash);
      while (txStatus.status === "NOT_FOUND") {
        await new Promise(r => setTimeout(r, 2000));
        txStatus = await server.getTransaction(result.hash);
      }
      if (txStatus.status === "FAILED") throw new Error("Transaction failed on-chain");
      
      const raw = scValToNative((txStatus as any).returnValue) as Uint8Array;
      const credentialId = Buffer.from(raw).toString("hex");
      
      setIssueResult(`Credential issued successfully!\nID: ${credentialId}\nEstimated fee: ${(estimatedFee / 10_000_000).toFixed(7)} XLM`);
      toast.success("Credential issued successfully.");
    } catch (e: unknown) {
      const message = handleError(e);
      setIssueResult(`Error: ${message}`);
      toast.error(message);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
      {/* Filter bar */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>Credentials</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              onClick={() => setShowImportModal(true)}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "var(--accent-light)",
                color: "white",
                border: "none",
                borderRadius: "0.25rem",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
              title="Import credentials from JSON or CSV"
            >
              📥 Import
            </button>
            {displayCredentials.length > 0 && (
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as "json" | "csv" | "pdf")}
                  style={{
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.85rem",
                    borderRadius: "0.25rem",
                    border: "1px solid var(--border-input)",
                    backgroundColor: "var(--card-bg)",
                    color: "var(--text)",
                  }}
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
                <button
                  onClick={() => handleExport(exportFormat)}
                  disabled={isExporting}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "var(--accent-light)",
                    color: "white",
                    border: "none",
                    borderRadius: "0.25rem",
                    cursor: isExporting ? "not-allowed" : "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    opacity: isExporting ? 0.6 : 1,
                  }}
                  title={`Export ${selectedCredentialsForExport.size > 0 ? selectedCredentialsForExport.size : displayCredentials.length} credentials`}
                >
                  📤 Export {selectedCredentialsForExport.size > 0 ? `(${selectedCredentialsForExport.size})` : ""}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Subject search */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <label htmlFor="credential-search" className="visually-hidden">
            Search credentials by subject address
          </label>
          <input
            id="credential-search"
            type="search"
            placeholder="Search by subject address (G…)"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            style={{ flex: 1 }}
          />
          <button onClick={handleSearch} disabled={fetching || !searchAddress.trim()}>
            {fetching ? "Searching…" : "Search"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {FILTER_OPTIONS.map((type) => {
            const count = countByType(displayCredentials, type);
            const isActive = activeFilter === type;
            return (
              <button
                key={type}
                onClick={() => handleFilterChange(type)}
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

        {lastCheckedAt && !fetching && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
            Last checked: {formatCheckedAt(lastCheckedAt)} (auto-refreshes every 30s)
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {EXPIRY_FILTER_OPTIONS.map((status) => {
            const count = countByExpiry(displayCredentials, status);
            const isActive = activeExpiryFilter === status;
            return (
              <button
                key={status}
                onClick={() => handleExpiryFilterChange(status)}
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
                aria-label={`Filter by ${status} credentials`}
              >
                {status}{" "}
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

        {fetching ? (
          <SkeletonCard variant="credential" />
        ) : fetchedCredentials !== null && fetchedCredentials.length === 0 ? (
          <CredentialEmptyState searchedAddress={searchedAddress} />
        ) : sortedCredentials.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No credentials match the selected filters.
          </p>
        ) : (
          <>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {pagedCredentials.map((cred) => {
              const status = getCredentialStatus(cred);
              return (
              <li
                key={cred.id}
                style={{
                  background: "var(--cred-item-bg)",
                  borderRadius: "0.5rem",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  aria-expanded={expandedCredId === cred.id}
                  style={{
                    padding: "0.6rem 1rem",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    fontSize: "0.85rem",
                    color: "var(--text)",
                    gap: "0.5rem 1rem",
                    cursor: "pointer",
                    background: "var(--cred-item-bg)",
                    border: 0,
                    borderRadius: 0,
                    textAlign: "left",
                  }}
                  onClick={() => setExpandedCredId(expandedCredId === cred.id ? null : cred.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedCredentialsForExport.has(cred.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleCredentialSelection(cred.id);
                    }}
                    style={{ cursor: "pointer" }}
                    aria-label={`Select credential ${cred.id}`}
                  />
                  <span style={{ fontSize: "1.2rem", minWidth: "1.5rem" }}>
                    {CREDENTIAL_TYPE_ICONS[cred.credentialType] || "📋"}
                  </span>
                  <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }} title={cred.id}>
                    {cred.id.slice(0, 8)}…{cred.id.slice(-6)}
                  </span>
                  <span className="badge badge-green">{cred.credentialType}</span>
                  <span
                    className={getStatusBadgeClass(status)}
                    aria-label={`Credential status: ${getStatusLabel(status)}`}
                    title={getStatusTooltip(cred, status)}
                  >
                    {getStatusLabel(status)}
                  </span>
                  <span style={getExpiryStyle(cred.expiresAt)}>{formatExpiry(cred.expiresAt)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = new URL(window.location.href);
                      url.searchParams.set('verify', cred.id);
                      navigator.clipboard.writeText(url.toString()).then(() => {
                        alert('Share link copied to clipboard!');
                      }).catch(() => {
                        alert('Failed to copy link');
                      });
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1rem",
                      color: "var(--accent-light)",
                      marginLeft: "auto",
                      marginRight: "0.5rem",
                    }}
                    title="Copy share link"
                  >
                    🔗
                  </button>
                  <span style={{ fontSize: "1rem" }}>
                    {expandedCredId === cred.id ? "▼" : "▶"}
                  </span>
                </button>
                {expandedCredId === cred.id && (
                  <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border-input)", background: "var(--card-bg-accent)" }}>
                    <dl style={{ margin: "0 0 0.75rem", fontSize: "0.8rem" }}>
                      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.25rem" }}>
                        <dt style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: "120px" }}>Issued</dt>
                        <dd style={{ margin: 0, color: "var(--text-muted)" }}>{formatTimestamp(cred.issuedAt)}</dd>
                      </div>
                      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
                        <dt style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: "120px" }}>Expires</dt>
                        <dd style={{ margin: 0, ...getExpiryStyle(cred.expiresAt) }}>{formatTimestamp(cred.expiresAt)}</dd>
                      </div>
                    </dl>
                    {Object.keys(cred.claims).length > 0 ? (
                      <dl style={{ margin: 0, fontSize: "0.85rem" }}>
                        {Object.entries(cred.claims).map(([key, value]) => (
                          <div key={key} style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
                            <dt style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: "120px" }}>{key}</dt>
                            <dd style={{ margin: 0, color: "var(--text)" }}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.8rem" }}>No claims</p>
                    )}
                    {/* Credential lifecycle timeline — closes #707 */}
                    <CredentialTimeline credential={cred} />
                  </div>
                )}
              </li>
              );
            })}
          </ul>

          {/* Pagination controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              marginTop: "1rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid var(--border-input)",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
            }}
          >
            <span>
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, totalCredentials)} of {totalCredentials}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label htmlFor="credential-page-size" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                Per page
                <select
                  id="credential-page-size"
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  style={{ fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>

              <button
                onClick={() => goToPage(clampedPage - 1)}
                disabled={clampedPage <= 1}
                aria-label="Previous page"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
              >
                ‹ Prev
              </button>

              <span>
                Page{" "}
                <input
                  type="number"
                  aria-label="Jump to page"
                  min={1}
                  max={totalPages}
                  value={clampedPage}
                  onChange={(e) => {
                    const next = parseInt(e.target.value, 10);
                    if (Number.isFinite(next) && next >= 1 && next <= totalPages) {
                      goToPage(next);
                    }
                  }}
                  style={{ width: "3rem", textAlign: "center", fontSize: "0.8rem", padding: "0.2rem" }}
                />{" "}
                of {totalPages}
              </span>

              <button
                onClick={() => goToPage(clampedPage + 1)}
                disabled={clampedPage >= totalPages}
                aria-label="Next page"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
              >
                Next ›
              </button>
            </div>
          </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Verify Credential</h2>
        <label htmlFor="verify-credential-id" className="visually-hidden">
          Credential ID to verify
        </label>
        <input
          id="verify-credential-id"
          placeholder="Credential ID (hex)"
          value={credId}
          onChange={(e) => setCredId(e.target.value)}
        />
        <button onClick={() => void handleVerify()} disabled={verifying || !credId}>
          {verifying ? "Verifying…" : "Verify"}
        </button>
        {verifying && <SkeletonCard variant="credential" />}
        {!verifying && verifyState !== "idle" && (
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
            {(verifyState === "invalid" || verifyState === "unknown") && (
              <span className="badge badge-red">Invalid</span>
            )}
            {verifyCheckedAt && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                Last checked: {formatCheckedAt(verifyCheckedAt)} (auto-refreshes every 30s)
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Issue Credential</h2>
        {wallet.connected ? (
          isIssuer ? (
            <>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                Issuing as{" "}
                <span style={{ color: "var(--accent-light)" }}>
                  {wallet.publicKey?.slice(0, 6)}…{wallet.publicKey?.slice(-4)}
                </span>
              </p>
              
              <FormField
                label="Subject Address"
                placeholder="Subject address (G…)"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                error={issueErrors.subject}
                style={{ marginBottom: "1rem" }}
              />

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                  Claims
                </label>
                {claims.map((claim, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <input
                      aria-label={`Claim key ${idx + 1}`}
                      placeholder="Key"
                      value={claim.key}
                      onChange={(e) => handleClaimChange(idx, "key", e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input
                      aria-label={`Claim value ${idx + 1}`}
                      placeholder="Value"
                      value={claim.value}
                      onChange={(e) => handleClaimChange(idx, "value", e.target.value)}
                      style={{ flex: 1 }}
                    />
                    {claims.length > 1 && (
                      <button
                        onClick={() => handleRemoveClaim(idx)}
                        style={{
                          padding: "0.5rem 0.75rem",
                          background: "var(--error)",
                          color: "white",
                          border: "none",
                          borderRadius: "0.25rem",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={handleAddClaim}
                  style={{
                    padding: "0.5rem 0.75rem",
                    background: "var(--accent-light)",
                    color: "white",
                    border: "none",
                    borderRadius: "0.25rem",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  + Add Claim
                </button>
                {issueErrors.claims && (
                  <p style={{ color: "var(--error)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    {issueErrors.claims}
                  </p>
                )}
              </div>

              <FormField
                label="Expires At (Unix timestamp, 0 for no expiry)"
                type="number"
                placeholder="0"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                error={issueErrors.expiresAt}
                style={{ marginBottom: "1rem" }}
              />

              <button onClick={handleIssue} disabled={issuing || Object.keys(issueErrors).length > 0}>
                {issuing ? "Issuing…" : "Issue KYC Credential"}
              </button>
              {issuing && <SkeletonCard variant="credential" />}
            </>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              {checkingIssuer ? "Checking issuer status…" : "Your wallet is not registered as an issuer. Contact the admin to register."}
            </p>
          )
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Connect your Freighter wallet to issue credentials as a registered issuer.
          </p>
        )}
        {!issuing && issueResult && <pre className="result">{issueResult}</pre>}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <CredentialImport
          onImport={handleImportCredentials}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </>
  );
}
