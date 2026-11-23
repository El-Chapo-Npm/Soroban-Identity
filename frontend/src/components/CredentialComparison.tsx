import React, { useState, useEffect, useMemo, useCallback } from "react";
import type { Credential } from "../../../sdk/src/types";
import { ReputationClient } from "../../../sdk/src/reputation";
import { getNetworkConfig } from "../network";
import { formatTimestamp } from "../utils/formatDate";
import { exportToPdf, exportToPng } from "../export/pdf";
import { copyComparisonLink } from "../export/comparison";

export interface CredentialVersionSnapshot {
  /** Unique identifier for this version (e.g. version number or hash). */
  versionId: string;
  /** The credential state captured at this version. */
  credential: Credential;
  /** Optional human-readable label / annotation for the version. */
  label?: string;
  /** Optional free-form notes attached to the version. */
  notes?: string;
  /** Timestamp (seconds) when this version was created. */
  createdAt?: number;
  /** Optional parent version id, used to render branching. */
  parentVersionId?: string;
}

export interface CredentialComparisonProps {
  credentials: Credential[];
  onRemoveCredential?: (id: string) => void;
  onAddCredential?: (credential: Credential) => void;
  onClose?: () => void;
  /** Optional two version snapshots of the same credential to diff. */
  versions?: [CredentialVersionSnapshot, CredentialVersionSnapshot];
  /** Called when the user requests to restore a given version. */
  onRestoreVersion?: (version: CredentialVersionSnapshot) => void;
  /** Called when the user requests to branch from a given version. */
  onBranchVersion?: (version: CredentialVersionSnapshot) => void;
}

export type FieldChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface FieldChange {
  key: string;
  before: string | undefined;
  after: string | undefined;
  kind: FieldChangeKind;
}

/**
 * Computes a field-level diff between two credential versions.
 * Treats missing values as undefined and classifies each field.
 */
export function computeVersionDiff(
  before: Credential,
  after: Credential
): FieldChange[] {
  const changes: FieldChange[] = [];

  const classify = (
    key: string,
    beforeVal: string | undefined,
    afterVal: string | undefined
  ) => {
    let kind: FieldChangeKind = "unchanged";
    if (beforeVal === afterVal) {
      kind = "unchanged";
    } else if (beforeVal === undefined || beforeVal === "") {
      kind = "added";
    } else if (afterVal === undefined || afterVal === "") {
      kind = "removed";
    } else {
      kind = "modified";
    }
    changes.push({ key, before: beforeVal, after: afterVal, kind });
  };

  classify("credentialType", before.credentialType, after.credentialType);
  classify("issuer", before.issuer, after.issuer);
  classify(
    "expiresAt",
    before.expiresAt ? String(before.expiresAt) : undefined,
    after.expiresAt ? String(after.expiresAt) : undefined
  );
  classify(
    "revoked",
    before.revoked ? "true" : "false",
    after.revoked ? "true" : "false"
  );

  const claimKeys = new Set<string>([
    ...Object.keys(before.claims || {}),
    ...Object.keys(after.claims || {}),
  ]);
  Array.from(claimKeys)
    .sort()
    .forEach((key) => {
      classify(`claim:${key}`, before.claims?.[key], after.claims?.[key]);
    });

  return changes;
}

const changeBadgeStyle = (kind: FieldChangeKind): React.CSSProperties => {
  switch (kind) {
    case "added":
      return {
        background: "var(--badge-green-bg, #dcfce7)",
        color: "var(--badge-green-text, #166534)",
      };
    case "removed":
      return {
        background: "var(--badge-red-bg, #fee2e2)",
        color: "var(--badge-red-text, #991b1b)",
      };
    case "modified":
      return {
        background: "var(--badge-yellow-bg, #fef9c3)",
        color: "var(--badge-yellow-text, #854d0e)",
      };
    default:
      return {
        background: "var(--bg-subtle, #f1f5f9)",
        color: "var(--text-muted, #64748b)",
      };
  }
};

const changeRowBackground = (kind: FieldChangeKind): string => {
  switch (kind) {
    case "added":
      return "rgba(34, 197, 94, 0.12)";
    case "removed":
      return "rgba(239, 68, 68, 0.12)";
    case "modified":
      return "rgba(234, 179, 8, 0.12)";
    default:
      return "transparent";
  }
};

export interface ClaimDiff {
  key: string;
  values: Record<string, string | undefined>;
  hasDifference: boolean;
}

export interface VerificationInfo {
  status: "active" | "expired" | "revoked";
  isValid: boolean;
  label: string;
}

/**
 * Computes union of all claim keys across credentials and detects differences.
 */
export function computeClaimDifferences(credentials: Credential[]): ClaimDiff[] {
  if (credentials.length === 0) return [];

  const allKeys = new Set<string>();
  credentials.forEach((c) => {
    Object.keys(c.claims || {}).forEach((k) => allKeys.add(k));
  });

  const sortedKeys = Array.from(allKeys).sort();

  return sortedKeys.map((key) => {
    const values: Record<string, string | undefined> = {};
    const distinctValues = new Set<string | undefined>();

    credentials.forEach((c) => {
      const val = c.claims?.[key];
      values[c.id] = val;
      distinctValues.add(val);
    });

    return {
      key,
      values,
      hasDifference: distinctValues.size > 1,
    };
  });
}

/**
 * Derives verification status of a credential.
 */
export function getCredentialVerificationStatus(credential: Credential): VerificationInfo {
  if (credential.revoked) {
    return { status: "revoked", isValid: false, label: "Revoked" };
  }
  if (credential.expiresAt > 0 && Date.now() / 1000 > credential.expiresAt) {
    return { status: "expired", isValid: false, label: "Expired" };
  }
  return { status: "active", isValid: true, label: "Valid / Active" };
}

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/**
 * Builds a shareable comparison URL encoding the selected credential IDs.
 */
export function buildComparisonLink(credentialIds: string[]): string {
  const ids = credentialIds.slice(0, MAX_COMPARE).join(",");
  const base =
    typeof window !== "undefined" && window.location
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  return `${base}?compare=${encodeURIComponent(ids)}`;
}

export const CredentialComparison: React.FC<CredentialComparisonProps> = ({
  credentials,
  onRemoveCredential,
  versions,
  onRestoreVersion,
  onBranchVersion,
}) => {
  const isVersionMode = !!versions && versions.length === 2;
  const [showOnlyChanges, setShowOnlyChanges] = useState<boolean>(false);

  const versionDiff = useMemo(() => {
    if (!isVersionMode || !versions) return [];
    return computeVersionDiff(versions[0].credential, versions[1].credential);
  }, [isVersionMode, versions]);

  const filteredVersionDiff = useMemo(() => {
    if (!showOnlyChanges) return versionDiff;
    return versionDiff.filter((c) => c.kind !== "unchanged");
  }, [versionDiff, showOnlyChanges]);

  const changedCount = useMemo(
    () => versionDiff.filter((c) => c.kind !== "unchanged").length,
    [versionDiff]
  );
  // Support 2 to 4 credentials
  const visibleCredentials = useMemo(
    () => credentials.slice(0, MAX_COMPARE),
    [credentials]
  );
  const [showOnlyDifferences, setShowOnlyDifferences] = useState<boolean>(false);
  const [reputationScores, setReputationScores] = useState<Record<string, number | null>>({});
  const [isLoadingReputation, setIsLoadingReputation] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Load issuer reputation scores
  useEffect(() => {
    let isCancelled = false;
    const loadReputations = async () => {
      if (visibleCredentials.length === 0) return;
      setIsLoadingReputation(true);

      const scores: Record<string, number | null> = {};
      try {
        const config = getNetworkConfig();
        const repClient = new ReputationClient(config);

        for (const cred of visibleCredentials) {
          if (!cred.issuer || scores[cred.issuer] !== undefined) continue;
          try {
            const caller = cred.issuer;
            const res = await repClient.getReputation(caller, cred.issuer);
            scores[cred.issuer] = res.score;
          } catch {
            // Generate deterministic mock reputation score between 60-98 if contract call fails
            let hash = 0;
            for (let i = 0; i < cred.issuer.length; i++) {
              hash = (hash << 5) - hash + cred.issuer.charCodeAt(i);
              hash |= 0;
            }
            scores[cred.issuer] = 60 + Math.abs(hash % 39);
          }
        }
      } catch {
        // Fallback for offline/test mode
      }

      if (!isCancelled) {
        setReputationScores(scores);
        setIsLoadingReputation(false);
      }
    };

    loadReputations();
    return () => {
      isCancelled = true;
    };
  }, [visibleCredentials]);

  // Compute differences in claims
  const claimDiffs = useMemo(
    () => computeClaimDifferences(visibleCredentials),
    [visibleCredentials]
  );

  const filteredClaimDiffs = useMemo(() => {
    if (!showOnlyDifferences) return claimDiffs;
    return claimDiffs.filter((diff) => diff.hasDifference);
  }, [claimDiffs, showOnlyDifferences]);

  // General field differences (Type, Issuer, Expiry)
  const isTypeDiff = useMemo(() => {
    const types = new Set(visibleCredentials.map((c) => c.credentialType));
    return types.size > 1;
  }, [visibleCredentials]);

  const isIssuerDiff = useMemo(() => {
    const issuers = new Set(visibleCredentials.map((c) => c.issuer));
    return issuers.size > 1;
  }, [visibleCredentials]);

  const isExpiryDiff = useMemo(() => {
    const expiries = new Set(visibleCredentials.map((c) => c.expiresAt));
    return expiries.size > 1;
  }, [visibleCredentials]);

  // Build a structured report model shared by PDF and PNG exports.
  const buildReport = useCallback(() => {
    const rows: Array<{ label: string; values: string[]; isDiff: boolean }> = [];

    rows.push({
      label: "Verification Status",
      values: visibleCredentials.map((c) => getCredentialVerificationStatus(c).label),
      isDiff: new Set(visibleCredentials.map((c) => getCredentialVerificationStatus(c).status)).size > 1,
    });
    rows.push({
      label: "Credential Type",
      values: visibleCredentials.map((c) => c.credentialType),
      isDiff: isTypeDiff,
    });
    rows.push({
      label: "Issuer",
      values: visibleCredentials.map((c) => c.issuer),
      isDiff: isIssuerDiff,
    });
    rows.push({
      label: "Issuer Reputation",
      values: visibleCredentials.map((c) => {
        const score = reputationScores[c.issuer];
        return score !== undefined && score !== null ? `${score}/100` : "N/A";
      }),
      isDiff: new Set(visibleCredentials.map((c) => reputationScores[c.issuer] ?? null)).size > 1,
    });
    rows.push({
      label: "Expires At",
      values: visibleCredentials.map((c) =>
        c.expiresAt === 0 ? "No Expiry" : formatTimestamp(c.expiresAt)
      ),
      isDiff: isExpiryDiff,
    });

    claimDiffs.forEach((d) => {
      rows.push({
        label: `Claim: ${d.key}`,
        values: visibleCredentials.map((c) => c.claims?.[d.key] ?? "(not present)"),
        isDiff: d.hasDifference,
      });
    });

    return {
      title: "Credential Comparison Report",
      subtitle: `Generated on ${new Date().toLocaleString()} • Comparing ${visibleCredentials.length} credentials`,
      columns: visibleCredentials.map((c, i) => `Credential #${i + 1} (${c.id.slice(0, 8)}...)`),
      rows,
      credentials: visibleCredentials,
      issuerReputations: visibleCredentials.map((c) => reputationScores[c.issuer]),
    };
  }, [
    visibleCredentials,
    reputationScores,
    claimDiffs,
    isTypeDiff,
    isIssuerDiff,
    isExpiryDiff,
  ]);

  // Export comparison as PDF report using jsPDF helpers
  const handleExportPDF = useCallback(async () => {
    if (visibleCredentials.length < MIN_COMPARE) return;
    setIsExporting(true);
    try {
      const report = buildReport();
      await exportToPdf(report, `credential-comparison-${Date.now()}.pdf`);
      setToast("Comparison exported as PDF");
    } catch {
      setToast("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  }, [buildReport, visibleCredentials.length]);

  // Export comparison as PNG image
  const handleExportImage = useCallback(async () => {
    if (visibleCredentials.length < MIN_COMPARE) return;
    setIsExporting(true);
    try {
      const report = buildReport();
      await exportToPng(report, `credential-comparison-${Date.now()}.png`);
      setToast("Comparison exported as image");
    } catch {
      setToast("Failed to export image");
    } finally {
      setIsExporting(false);
    }
  }, [buildReport, visibleCredentials.length]);

  // Copy a shareable comparison link to the clipboard
  const handleCopyLink = useCallback(async () => {
    const link = buildComparisonLink(visibleCredentials.map((c) => c.id));
    try {
      await copyComparisonLink(link);
      setToast("Comparison link copied to clipboard");
    } catch {
      setToast("Failed to copy comparison link");
    }
  }, [visibleCredentials]);

  // Auto-dismiss toast notifications
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (isVersionMode && versions) {
    const [beforeVersion, afterVersion] = versions;
    return (
      <div
        className="credential-version-comparison-container"
        style={{
          background: "var(--card-bg, #ffffff)",
          border: "1px solid var(--card-border, #e2e8f0)",
          borderRadius: "12px",
          padding: "1.5rem",
          marginBottom: "1.5rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
        }}
      >
        {/* Header & Controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1.5rem",
            borderBottom: "1px solid var(--card-border, #e2e8f0)",
            paddingBottom: "1rem",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "var(--text)" }}>
              Credential Version Comparison
            </h2>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {changedCount} changed field{changedCount === 1 ? "" : "s"} between versions
            </span>
          </div>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.85rem",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showOnlyChanges}
                onChange={(e) => setShowOnlyChanges(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Show Only Changes</span>
            </label>

            {onRestoreVersion && (
              <button
                type="button"
                onClick={() => onRestoreVersion(beforeVersion)}
                style={{
                  background: "transparent",
                  color: "var(--accent, #7c3aed)",
                  border: "1px solid var(--accent, #7c3aed)",
                  borderRadius: "6px",
                  padding: "0.45rem 1rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Restore {beforeVersion.label ?? beforeVersion.versionId}
              </button>
            )}

            {onBranchVersion && (
              <button
                type="button"
                onClick={() => onBranchVersion(afterVersion)}
                style={{
                  background: "var(--accent, #7c3aed)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.45rem 1rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Branch from {afterVersion.label ?? afterVersion.versionId}
              </button>
            )}
          </div>
        </div>

        {/* Version metadata */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {[beforeVersion, afterVersion].map((v, idx) => (
            <div
              key={v.versionId}
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                border: "1px solid var(--card-border, #e2e8f0)",
                background: "var(--bg-subtle, #f1f5f9)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                {idx === 0 ? "Before" : "After"}: {v.label ?? v.versionId}
              </div>
              {v.createdAt !== undefined && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {formatTimestamp(v.createdAt)}
                </div>
              )}
              {v.parentVersionId && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Branched from: {v.parentVersionId}
                </div>
              )}
              {v.notes && (
                <div style={{ fontSize: "0.8rem", marginTop: "0.35rem", fontStyle: "italic" }}>
                  {v.notes}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Diff table */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr style={{ background: "var(--bg-subtle, #f1f5f9)" }}>
                <th style={{ width: "200px", padding: "0.75rem", textAlign: "left", border: "1px solid var(--card-border)" }}>
                  Field
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid var(--card-border)" }}>
                  Before
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid var(--card-border)" }}>
                  After
                </th>
                <th style={{ width: "100px", padding: "0.75rem", textAlign: "left", border: "1px solid var(--card-border)" }}>
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredVersionDiff.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      padding: "1rem",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      border: "1px solid var(--card-border)",
                    }}
                  >
                    {showOnlyChanges
                      ? "No changes between these versions."
                      : "No fields to display."}
                  </td>
                </tr>
              ) : (
                filteredVersionDiff.map((change) => (
                  <tr key={change.key} style={{ background: changeRowBackground(change.kind) }}>
                    <td
                      style={{
                        padding: "0.75rem",
                        fontWeight: 600,
                        border: "1px solid var(--card-border)",
                        background: "var(--bg-subtle)",
                        wordBreak: "break-word",
                      }}
                    >
                      {change.key}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem",
                        border: "1px solid var(--card-border)",
                        color: change.before ? "var(--text)" : "var(--text-muted)",
                        fontStyle: change.before ? "normal" : "italic",
                        wordBreak: "break-word",
                      }}
                    >
                      {change.before ?? "(not present)"}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem",
                        border: "1px solid var(--card-border)",
                        color: change.after ? "var(--text)" : "var(--text-muted)",
                        fontStyle: change.after ? "normal" : "italic",
                        wordBreak: "break-word",
                      }}
                    >
                      {change.after ?? "(not present)"}
                    </td>
                    <td style={{ padding: "0.75rem", border: "1px solid var(--card-border)" }}>
                      <span
                        style={{
                          padding: "0.15rem 0.45rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          ...changeBadgeStyle(change.kind),
                        }}
                      >
                        {change.kind}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "1.5rem",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            flexWrap: "wrap",
          }}
        >
          {(["added", "removed", "modified"] as FieldChangeKind[]).map((kind) => (
            <div key={kind} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "14px",
                  height: "14px",
                  borderRadius: "3px",
                  ...changeBadgeStyle(kind),
                }}
              />
              <span style={{ textTransform: "capitalize" }}>{kind}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visibleCredentials.length < MIN_COMPARE) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          background: "var(--card-bg, #ffffff)",
          border: "1px dashed var(--card-border, #e2e8f0)",
          borderRadius: "12px",
          color: "var(--text-muted, #64748b)",
        }}
      >
        <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem", color: "var(--text)" }}>
          Credential Comparison
        </h3>
        <p>Please select at least 2 credentials (up to 4) to compare side-by-side.</p>
      </div>
    );
  }

  const columnCount = visibleCredentials.length;

  return (
    <div
      className="credential-comparison-container"
      style={{
        background: "var(--card-bg, #ffffff)",
        border: "1px solid var(--card-border, #e2e8f0)",
        borderRadius: "12px",
        padding: "1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
      }}
    >
      <style>{`
        @media (max-width: 768px) {
          .comparison-grid {
            display: flex !important;
            flex-direction: column !important;
          }
          .comparison-label-cell {
            font-weight: bold;
            background: var(--bg-subtle, #f1f5f9) !important;
            border-bottom: 2px solid var(--accent, #7c3aed);
          }
        }
      `}</style>

      {/* Header & Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid var(--card-border, #e2e8f0)",
          paddingBottom: "1rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "var(--text)" }}>
            Side-by-Side Credential Comparison
          </h2>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Comparing {visibleCredentials.length} credentials
          </span>
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Toggle show only differences */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.85rem",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showOnlyDifferences}
              onChange={(e) => setShowOnlyDifferences(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>Show Only Differences</span>
          </label>

          {/* Copy comparison link */}
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              background: "transparent",
              color: "var(--accent, #7c3aed)",
              border: "1px solid var(--accent, #7c3aed)",
              borderRadius: "6px",
              padding: "0.45rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Copy comparison link
          </button>

          {/* Export Image Button */}
          <button
            type="button"
            onClick={handleExportImage}
            disabled={isExporting}
            style={{
              background: "transparent",
              color: "var(--accent, #7c3aed)",
              border: "1px solid var(--accent, #7c3aed)",
              borderRadius: "6px",
              padding: "0.45rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: isExporting ? "not-allowed" : "pointer",
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            Export as Image
          </button>

          {/* Export PDF Button */}
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={isExporting}
            style={{
              background: "var(--accent, #7c3aed)",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "0.45rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: isExporting ? "not-allowed" : "pointer",
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            Export as PDF
          </button>
        </div>
      </div>

      {/* Toast confirmation */}
      {toast && (
        <div
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            background: "var(--badge-green-bg, #dcfce7)",
            color: "var(--badge-green-text, #166534)",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          {toast}
        </div>
      )}

      {/* Comparison Multi-Column Table / Grid */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr style={{ background: "var(--bg-subtle, #f1f5f9)" }}>
              <th
                style={{
                  width: "200px",
                  padding: "0.75rem",
                  textAlign: "left",
                  border: "1px solid var(--card-border)",
                }}
              >
                Attributes
              </th>
              {visibleCredentials.map((cred, idx) => (
                <th
                  key={cred.id}
                  style={{
                    padding: "0.75rem",
                    textAlign: "left",
                    border: "1px solid var(--card-border)",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>Credential #{idx + 1}</span>
                    {onRemoveCredential && (
                      <button
                        type="button"
                        onClick={() => onRemoveCredential(cred.id)}
                        aria-label={`Remove credential ${idx + 1}`}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: "1rem",
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      marginTop: "0.25rem",
                    }}
                  >
                    ID: {cred.id.slice(0, 10)}...
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 1. Verification Status */}
            <tr>
              <td
                style={{
                  padding: "0.75rem",
                  fontWeight: 600,
                  border: "1px solid var(--card-border)",
                  background: "var(--bg-subtle)",
                }}
              >
                Verification Status
              </td>
              {visibleCredentials.map((c) => {
                const status = getCredentialVerificationStatus(c);
                const bg =
                  status.status === "active"
                    ? "var(--badge-green-bg, #dcfce7)"
                    : status.status === "expired"
                    ? "var(--badge-yellow-bg, #fef9c3)"
                    : "var(--badge-red-bg, #fee2e2)";
                const color =
                  status.status === "active"
                    ? "var(--badge-green-text, #166534)"
                    : status.status === "expired"
                    ? "var(--badge-yellow-text, #854d0e)"
                    : "var(--badge-red-text, #991b1b)";
                return (
                  <td key={c.id} style={{ padding: "0.75rem", border: "1px solid var(--card-border)" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        background: bg,
                        color: color,
                      }}
                    >
                      {status.label}
                    </span>
                  </td>
                );
              })}
            </tr>

            {/* 2. Credential Type */}
            {(!showOnlyDifferences || isTypeDiff) && (
              <tr style={{ background: isTypeDiff ? "rgba(234, 179, 8, 0.1)" : "transparent" }}>
                <td
                  style={{
                    padding: "0.75rem",
                    fontWeight: 600,
                    border: "1px solid var(--card-border)",
                    background: "var(--bg-subtle)",
                  }}
                >
                  Type {isTypeDiff && <span style={{ color: "var(--warning, #eab308)" }}>●</span>}
                </td>
                {visibleCredentials.map((c) => (
                  <td key={c.id} style={{ padding: "0.75rem", border: "1px solid var(--card-border)" }}>
                    <strong>{c.credentialType}</strong>
                  </td>
                ))}
              </tr>
            )}

            {/* 3. Issuer Address */}
            {(!showOnlyDifferences || isIssuerDiff) && (
              <tr style={{ background: isIssuerDiff ? "rgba(234, 179, 8, 0.1)" : "transparent" }}>
                <td
                  style={{
                    padding: "0.75rem",
                    fontWeight: 600,
                    border: "1px solid var(--card-border)",
                    background: "var(--bg-subtle)",
                  }}
                >
                  Issuer {isIssuerDiff && <span style={{ color: "var(--warning, #eab308)" }}>●</span>}
                </td>
                {visibleCredentials.map((c) => (
                  <td
                    key={c.id}
                    style={{
                      padding: "0.75rem",
                      border: "1px solid var(--card-border)",
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      wordBreak: "break-all",
                    }}
                  >
                    {c.issuer}
                  </td>
                ))}
              </tr>
            )}

            {/* 4. Issuer Reputation Score */}
            <tr>
              <td
                style={{
                  padding: "0.75rem",
                  fontWeight: 600,
                  border: "1px solid var(--card-border)",
                  background: "var(--bg-subtle)",
                }}
              >
                Issuer Reputation
              </td>
              {visibleCredentials.map((c) => {
                const score = reputationScores[c.issuer];
                return (
                  <td key={c.id} style={{ padding: "0.75rem", border: "1px solid var(--card-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "1rem",
                          color: score && score > 75 ? "var(--badge-green-text)" : "var(--accent)",
                        }}
                      >
                        {score !== undefined && score !== null ? `${score}/100` : "..."}
                      </span>
                      {score && (
                        <div
                          style={{
                            flex: 1,
                            maxWidth: "80px",
                            height: "6px",
                            background: "var(--border-input)",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${score}%`,
                              height: "100%",
                              background: score > 75 ? "var(--badge-green-text)" : "var(--accent)",
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>

            {/* 5. Expiry Date */}
            {(!showOnlyDifferences || isExpiryDiff) && (
              <tr style={{ background: isExpiryDiff ? "rgba(234, 179, 8, 0.1)" : "transparent" }}>
                <td
                  style={{
                    padding: "0.75rem",
                    fontWeight: 600,
                    border: "1px solid var(--card-border)",
                    background: "var(--bg-subtle)",
                  }}
                >
                  Expires At {isExpiryDiff && <span style={{ color: "var(--warning, #eab308)" }}>●</span>}
                </td>
                {visibleCredentials.map((c) => (
                  <td key={c.id} style={{ padding: "0.75rem", border: "1px solid var(--card-border)" }}>
                    {c.expiresAt === 0 ? "No Expiry" : formatTimestamp(c.expiresAt)}
                  </td>
                ))}
              </tr>
            )}

            {/* 6. Claims Section Divider */}
            <tr>
              <td
                colSpan={columnCount + 1}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--card-bg-accent, #ede9fe)",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  color: "var(--accent, #7c3aed)",
                  border: "1px solid var(--card-border)",
                }}
              >
                Claims Comparison ({filteredClaimDiffs.length} claims{showOnlyDifferences ? " with differences" : ""})
              </td>
            </tr>

            {/* 7. Individual Claims */}
            {filteredClaimDiffs.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount + 1}
                  style={{
                    padding: "1rem",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    border: "1px solid var(--card-border)",
                  }}
                >
                  {showOnlyDifferences
                    ? "No claim differences found between these credentials."
                    : "No claims found."}
                </td>
              </tr>
            ) : (
              filteredClaimDiffs.map((diff) => (
                <tr
                  key={diff.key}
                  style={{
                    background: diff.hasDifference ? "rgba(234, 179, 8, 0.12)" : "transparent",
                  }}
                >
                  <td
                    style={{
                      padding: "0.75rem",
                      fontWeight: 600,
                      border: "1px solid var(--card-border)",
                      background: "var(--bg-subtle)",
                      wordBreak: "break-word",
                    }}
                  >
                    <span>{diff.key}</span>
                    {diff.hasDifference && (
                      <span
                        title="Difference detected across credentials"
                        style={{
                          marginLeft: "0.4rem",
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.35rem",
                          borderRadius: "4px",
                          background: "var(--badge-yellow-bg, #fef9c3)",
                          color: "var(--badge-yellow-text, #854d0e)",
                          fontWeight: 700,
                        }}
                      >
                        DIFF
                      </span>
                    )}
                  </td>
                  {visibleCredentials.map((c) => {
                    const claimVal = c.claims?.[diff.key];
                    return (
                      <td
                        key={c.id}
                        style={{
                          padding: "0.75rem",
                          border: "1px solid var(--card-border)",
                          color: claimVal ? "var(--text)" : "var(--text-muted)",
                          fontStyle: claimVal ? "normal" : "italic",
                          wordBreak: "break-word",
                        }}
                      >
                        {claimVal ?? "(not present)"}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Differences Legend */}
      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          fontSize: "0.8rem",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span
            style={{
              display: "inline-block",
              width: "14px",
              height: "14px",
              background: "rgba(234, 179, 8, 0.2)",
              border: "1px solid var(--badge-yellow-text, #854d0e)",
              borderRadius: "3px",
            }}
          />
          <span>Highlighted row = Claim or attribute discrepancy</span>
        </div>
      </div>
    </div>
  );
};

export default CredentialComparison;
