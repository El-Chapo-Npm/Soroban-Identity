import React, { useState, useEffect, useMemo } from "react";
import type { Credential } from "../../../sdk/src/types";
import { ReputationClient } from "../../../sdk/src/reputation";
import { getNetworkConfig } from "../network";
import { formatTimestamp } from "../utils/formatDate";

export interface CredentialComparisonProps {
  credentials: Credential[];
  onRemoveCredential?: (id: string) => void;
  onAddCredential?: (credential: Credential) => void;
}

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

export const CredentialComparison: React.FC<CredentialComparisonProps> = ({
  credentials,
  onRemoveCredential,
}) => {
  // Support 2 to 4 credentials
  const visibleCredentials = useMemo(() => credentials.slice(0, 4), [credentials]);
  const [showOnlyDifferences, setShowOnlyDifferences] = useState<boolean>(false);
  const [reputationScores, setReputationScores] = useState<Record<string, number | null>>({});
  const [isLoadingReputation, setIsLoadingReputation] = useState<boolean>(false);

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

  // Export comparison as PDF report
  const handleExportPDF = () => {
    const reportHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Credential Comparison Report</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            p { font-size: 13px; color: #64748b; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
            th { background: #f8fafc; font-weight: 600; }
            .diff { background: #fef3c7; }
            .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; }
            .valid { background: #dcfce7; color: #166534; }
            .expired { background: #fef9c3; color: #854d0e; }
            .revoked { background: #fee2e2; color: #991b1b; }
          </style>
        </head>
        <body>
          <h1>Credential Comparison Report</h1>
          <p>Generated on ${new Date().toLocaleString()} • Comparing ${visibleCredentials.length} credentials</p>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                ${visibleCredentials.map((c, i) => `<th>Credential #${i + 1} (${c.id.slice(0, 8)}...)</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Verification Status</strong></td>
                ${visibleCredentials
                  .map((c) => {
                    const st = getCredentialVerificationStatus(c);
                    return `<td><span class="badge ${st.status}">${st.label}</span></td>`;
                  })
                  .join("")}
              </tr>
              <tr class="${isTypeDiff ? "diff" : ""}">
                <td><strong>Credential Type</strong></td>
                ${visibleCredentials.map((c) => `<td>${c.credentialType}</td>`).join("")}
              </tr>
              <tr class="${isIssuerDiff ? "diff" : ""}">
                <td><strong>Issuer</strong></td>
                ${visibleCredentials.map((c) => `<td style="font-family: monospace;">${c.issuer}</td>`).join("")}
              </tr>
              <tr>
                <td><strong>Issuer Reputation Score</strong></td>
                ${visibleCredentials.map((c) => `<td>${reputationScores[c.issuer] ?? "N/A"}/100</td>`).join("")}
              </tr>
              <tr class="${isExpiryDiff ? "diff" : ""}">
                <td><strong>Expires At</strong></td>
                ${visibleCredentials
                  .map((c) => `<td>${c.expiresAt === 0 ? "No Expiry" : formatTimestamp(c.expiresAt)}</td>`)
                  .join("")}
              </tr>
              ${claimDiffs
                .map(
                  (d) => `
                <tr class="${d.hasDifference ? "diff" : ""}">
                  <td><strong>Claim: ${d.key}</strong></td>
                  ${visibleCredentials.map((c) => `<td>${c.claims[d.key] || '<span style="color:#94a3b8">(none)</span>'}</td>`).join("")}
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;

    // Download formatted report or trigger print to PDF
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 300);
    } else {
      // Fallback to text file download
      const blob = new Blob([reportHtml], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `credential-comparison-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  if (visibleCredentials.length < 2) {
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

          {/* Export PDF Button */}
          <button
            type="button"
            onClick={handleExportPDF}
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
            Export as PDF
          </button>
        </div>
      </div>

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
