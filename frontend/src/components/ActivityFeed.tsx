import React, { useState, useMemo, useCallback } from "react";
import { formatTimestamp } from "../utils/formatDate";
import { useToast } from "../context/ToastContext";
import { getActiveNetwork, isMainnet } from "../network";

export type ActivityType =
  | "credential_issued"
  | "credential_verified"
  | "credential_revoked"
  | "did_registered"
  | "did_updated"
  | "reputation_updated";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: number; // Unix seconds
  txHash: string;
  feeStroops: number;
  actor: string;
  subject?: string;
  credentialType?: string;
}

const DEFAULT_ACTIVITIES: ActivityItem[] = [
  {
    id: "act-1",
    type: "credential_issued",
    title: "Credential Issued",
    description: "KYC Tier-1 Credential issued to GAB...492",
    timestamp: Math.floor(Date.now() / 1000) - 300,
    txHash: "4f5c9e2d8b1a7f6c3e0d9b8a7f6c5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f",
    feeStroops: 100,
    actor: "GBBD...821",
    subject: "GAB...492",
    credentialType: "Kyc",
  },
  {
    id: "act-2",
    type: "did_registered",
    title: "DID Registered",
    description: "Registered decentralized identity did:soroban:GBBD...821",
    timestamp: Math.floor(Date.now() / 1000) - 1800,
    txHash: "3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a",
    feeStroops: 100,
    actor: "GBBD...821",
  },
  {
    id: "act-3",
    type: "credential_verified",
    title: "Credential Verified",
    description: "Third-party cryptographic signature verification check succeeded",
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    txHash: "2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b",
    feeStroops: 250,
    actor: "GCT...110",
    subject: "GAB...492",
    credentialType: "Kyc",
  },
  {
    id: "act-4",
    type: "reputation_updated",
    title: "Reputation Score Updated",
    description: "Score boosted by +20 points following KYC verification",
    timestamp: Math.floor(Date.now() / 1000) - 7200,
    txHash: "1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f",
    feeStroops: 150,
    actor: "GBBD...821",
    subject: "GAB...492",
  },
  {
    id: "act-5",
    type: "did_updated",
    title: "DID Document Updated",
    description: "Updated service endpoints and public authentication keys",
    timestamp: Math.floor(Date.now() / 1000) - 14400,
    txHash: "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e",
    feeStroops: 100,
    actor: "GBBD...821",
  },
  {
    id: "act-6",
    type: "credential_revoked",
    title: "Credential Revoked",
    description: "Revocation of expired Employment certificate",
    timestamp: Math.floor(Date.now() / 1000) - 86400,
    txHash: "8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d",
    feeStroops: 100,
    actor: "GBBD...821",
    subject: "GDF...991",
    credentialType: "Custom",
  },
];

const STORAGE_KEY = "soroban_activity_feed_items";

export function getStoredActivities(): ActivityItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ACTIVITIES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ACTIVITIES;
  } catch {
    return DEFAULT_ACTIVITIES;
  }
}

export function saveStoredActivity(activity: ActivityItem): void {
  try {
    const current = getStoredActivities();
    const updated = [activity, ...current];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 100)));
  } catch {
    // Ignore storage errors
  }
}

const TYPE_COLORS: Record<ActivityType, { bg: string; text: string; icon: string }> = {
  credential_issued: { bg: "#e0f2fe", text: "#0369a1", icon: "✦" },
  credential_verified: { bg: "#dcfce7", text: "#15803d", icon: "✓" },
  credential_revoked: { bg: "#fee2e2", text: "#b91c1c", icon: "✕" },
  did_registered: { bg: "#f3e8ff", text: "#7e22ce", icon: "🆔" },
  did_updated: { bg: "#fef9c3", text: "#a16207", icon: "↻" },
  reputation_updated: { bg: "#ffedd5", text: "#c2410c", icon: "★" },
};

export const ActivityFeed: React.FC = () => {
  const toast = useToast();
  const [activities, setActivities] = useState<ActivityItem[]>(() => getStoredActivities());
  const [selectedType, setSelectedType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(10);

  const network = getActiveNetwork();
  const mainnet = isMainnet(network);
  const explorerBaseUrl = mainnet
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (selectedType !== "all" && act.type !== selectedType) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          act.title.toLowerCase().includes(q) ||
          act.description.toLowerCase().includes(q) ||
          act.actor.toLowerCase().includes(q) ||
          (act.subject && act.subject.toLowerCase().includes(q)) ||
          act.txHash.toLowerCase().includes(q) ||
          (act.credentialType && act.credentialType.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (startDate) {
        const startSec = new Date(startDate).getTime() / 1000;
        if (act.timestamp < startSec) return false;
      }
      if (endDate) {
        const endSec = new Date(endDate).getTime() / 1000 + 86400;
        if (act.timestamp > endSec) return false;
      }
      return true;
    });
  }, [activities, selectedType, searchQuery, startDate, endDate]);

  const pagedActivities = useMemo(() => {
    return filteredActivities.slice(0, visibleCount);
  }, [filteredActivities, visibleCount]);

  const hasMore = visibleCount < filteredActivities.length;

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + 10);
  };

  const exportCSV = useCallback(() => {
    const headers = [
      "ID",
      "Type",
      "Title",
      "Description",
      "Timestamp",
      "Date",
      "Transaction Hash",
      "Fee (Stroops)",
      "Fee (XLM)",
      "Actor",
      "Subject",
      "Credential Type",
    ];
    const rows = filteredActivities.map((a) => [
      `"${a.id}"`,
      `"${a.type}"`,
      `"${a.title.replace(/"/g, '""')}"`,
      `"${a.description.replace(/"/g, '""')}"`,
      a.timestamp,
      `"${new Date(a.timestamp * 1000).toISOString()}"`,
      `"${a.txHash}"`,
      a.feeStroops,
      (a.feeStroops / 10_000_000).toFixed(7),
      `"${a.actor}"`,
      `"${a.subject ?? ""}"`,
      `"${a.credentialType ?? ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `activity_feed_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Activity feed exported to CSV.");
  }, [filteredActivities, toast]);

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(filteredActivities, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `activity_feed_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Activity feed exported to JSON.");
  }, [filteredActivities, toast]);

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "1.5rem 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 0.25rem 0", fontSize: "1.5rem", fontWeight: 700 }}>
            Activity Feed Dashboard
          </h2>
          <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: "0.9rem" }}>
            Real-time chronological timeline of DID, credential, and reputation transactions.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={exportCSV}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              backgroundColor: "var(--card-bg, #ffffff)",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            📊 Export CSV
          </button>
          <button
            type="button"
            onClick={exportJSON}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              backgroundColor: "var(--card-bg, #ffffff)",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            📋 Export JSON
          </button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1.5rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--border-input, #e2e8f0)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Search Activities
          </label>
          <input
            type="text"
            placeholder="Search by actor, subject, tx, text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              fontSize: "0.85rem",
            }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Activity Type
          </label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              fontSize: "0.85rem",
            }}
          >
            <option value="all">All Operations</option>
            <option value="credential_issued">Credentials Issued</option>
            <option value="credential_verified">Credentials Verified</option>
            <option value="credential_revoked">Credentials Revoked</option>
            <option value="did_registered">DIDs Registered</option>
            <option value="did_updated">DIDs Updated</option>
            <option value="reputation_updated">Reputation Updates</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              fontSize: "0.85rem",
            }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              fontSize: "0.85rem",
            }}
          />
        </div>
      </div>

      {/* Timeline items list */}
      {pagedActivities.length === 0 ? (
        <div
          className="card"
          style={{
            padding: "3rem",
            textAlign: "center",
            color: "var(--text-muted, #64748b)",
            borderRadius: "0.5rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "1rem" }}>No matching activity found for the selected filters.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {pagedActivities.map((act) => {
            const typeConfig = TYPE_COLORS[act.type] || { bg: "#f1f5f9", text: "#475569", icon: "•" };
            const feeXlm = (act.feeStroops / 10_000_000).toFixed(5);
            return (
              <div
                key={act.id}
                className="card"
                style={{
                  display: "flex",
                  gap: "1rem",
                  padding: "1rem 1.25rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border-input, #e2e8f0)",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    borderRadius: "50%",
                    backgroundColor: typeConfig.bg,
                    color: typeConfig.text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.2rem",
                    flexShrink: 0,
                  }}
                >
                  {typeConfig.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "1rem" }}>{act.title}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>
                      {formatTimestamp(act.timestamp)}
                    </span>
                  </div>

                  <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "var(--text, #334155)" }}>
                    {act.description}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "1rem",
                      fontSize: "0.8rem",
                      color: "var(--text-muted, #64748b)",
                    }}
                  >
                    <span>
                      <strong>Tx:</strong>{" "}
                      <a
                        href={`${explorerBaseUrl}/${act.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--primary, #3b82f6)", textDecoration: "none" }}
                      >
                        {act.txHash.slice(0, 8)}...{act.txHash.slice(-8)} ↗
                      </a>
                    </span>

                    <span>
                      <strong>Gas:</strong> {act.feeStroops} stroops ({feeXlm} XLM)
                    </span>

                    <span>
                      <strong>Actor:</strong> {act.actor.slice(0, 6)}...{act.actor.slice(-4)}
                    </span>

                    {act.subject && (
                      <span>
                        <strong>Subject:</strong> {act.subject.slice(0, 6)}...{act.subject.slice(-4)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={handleLoadMore}
                style={{
                  padding: "0.6rem 1.5rem",
                  borderRadius: "0.375rem",
                  backgroundColor: "var(--bg-accent, #f1f5f9)",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Load More Activities ({filteredActivities.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
