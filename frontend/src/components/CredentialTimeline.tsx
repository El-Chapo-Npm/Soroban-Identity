/**
 * CredentialTimeline — interactive lifecycle visualization for a credential.
 *
 * Shows issued, verified, expired and revoked events on a horizontal timeline.
 * Supports:
 *   - Color-coded event markers
 *   - Hover tooltips with event details
 *   - Zoom (wheel / pinch) and pan (drag) for long histories
 *   - Filtering by event type
 *   - Export as PNG via canvas
 *
 * Closes #707.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { Credential } from "../../../sdk/src/types";
import { formatTimestamp } from "../utils/formatDate";

// ── Activity feed types ───────────────────────────────────────────────────────

/**
 * Minimal shape of a streamed contract event consumed by the activity feed.
 * Kept structural so callers can pass SDK event objects directly.
 */
export interface StreamedContractEvent {
  id?: string;
  type: string;
  credentialId?: string;
  subject?: string;
  issuer?: string;
  timestamp: number; // Unix seconds
  txHash?: string;
  gasCost?: number | string;
  ledger?: number;
  detail?: string;
}

export type ActivityType = "issued" | "verified" | "revoked" | "amended";

const ACTIVITY_TYPES: ActivityType[] = ["issued", "verified", "revoked", "amended"];

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  issued: "var(--accent-light, #6c63ff)",
  verified: "var(--success-text, #155724)",
  revoked: "var(--error, #dc3545)",
  amended: "var(--info, #0c5460)",
};

const ACTIVITY_BG: Record<ActivityType, string> = {
  issued: "var(--card-bg-accent, #f0eeff)",
  verified: "var(--success-bg, #d4edda)",
  revoked: "var(--danger-bg, #f8d7da)",
  amended: "var(--info-bg, #d1ecf1)",
};

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  issued: "✦",
  verified: "✓",
  revoked: "✕",
  amended: "↻",
};

function normalizeActivityType(raw: string): ActivityType | null {
  const t = raw.toLowerCase();
  if (t.includes("issue")) return "issued";
  if (t.includes("verif")) return "verified";
  if (t.includes("revok")) return "revoked";
  if (t.includes("amend") || t.includes("updat")) return "amended";
  return null;
}

function explorerTxUrl(network: string, hash: string): string {
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

function formatGas(gas: number | string | undefined): string | null {
  if (gas === undefined || gas === null || gas === "") return null;
  const n = typeof gas === "string" ? Number(gas) : gas;
  if (!Number.isFinite(n)) return String(gas);
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 7 })} stroops`;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimelineEventType = "issued" | "verified" | "expired" | "revoked" | "amended";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: number; // Unix seconds
  label: string;
  detail: string;
}

interface Props {
  /** Single-credential mode: the credential to visualize. */
  credential?: Credential;
  /** Optional additional verified-at timestamps from external checks. */
  verifiedAt?: number[];
  /**
   * Activity feed mode: when provided, renders a chronological vertical
   * timeline of recent credential / DID operations instead of the
   * single-credential horizontal timeline.
   */
  events?: StreamedContractEvent[];
  /** Stellar network used for explorer links (e.g. "testnet", "public"). */
  network?: string;
  /** Called when the user scrolls near the bottom of the feed. */
  onLoadMore?: () => void;
  /** Whether more history is available (enables infinite scroll). */
  hasMore?: boolean;
  /** Whether a page of history is currently loading. */
  loadingMore?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<TimelineEventType, string> = {
  issued: "var(--accent-light, #6c63ff)",
  verified: "var(--success-text, #155724)",
  expired: "var(--warning, #856404)",
  revoked: "var(--error, #dc3545)",
  amended: "var(--info, #0c5460)",
};

const EVENT_BG: Record<TimelineEventType, string> = {
  issued: "var(--card-bg-accent, #f0eeff)",
  verified: "var(--success-bg, #d4edda)",
  expired: "var(--warning-bg, #fff3cd)",
  revoked: "var(--danger-bg, #f8d7da)",
  amended: "var(--info-bg, #d1ecf1)",
};

const EVENT_ICONS: Record<TimelineEventType, string> = {
  issued: "✦",
  verified: "✓",
  expired: "⏳",
  revoked: "✕",
  amended: "↻",
};

const EVENT_LABELS: Record<TimelineEventType, string> = {
  issued: "Issued",
  verified: "Verified",
  expired: "Expired",
  revoked: "Revoked",
  amended: "Amended",
};

const ALL_EVENT_TYPES: TimelineEventType[] = ["issued", "verified", "expired", "revoked", "amended"];

// ── Helper ────────────────────────────────────────────────────────────────────

function buildEvents(credential: Credential, verifiedAt: number[] = []): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Issued
  events.push({
    id: `issued-${credential.id}`,
    type: "issued",
    timestamp: credential.issuedAt ?? 0,
    label: "Issued",
    detail: `Issued by ${credential.issuer?.slice(0, 8) ?? "unknown"}… to ${credential.subject?.slice(0, 8) ?? "unknown"}…`,
  });

  // Verification checks
  verifiedAt.forEach((ts, i) => {
    events.push({
      id: `verified-${credential.id}-${i}`,
      type: "verified",
      timestamp: ts,
      label: "Verified",
      detail: `Credential verified at ${formatTimestamp(ts)}`,
    });
  });

  if (credential.version && credential.version > 1) {
    const amendedTs = credential.lastModifiedAt ?? credential.issuedAt ?? 0;
    events.push({
      id: `amended-${credential.id}-${credential.version}`,
      type: "amended",
      timestamp: amendedTs,
      label: "Amended",
      detail: `Version ${credential.version} amended${credential.versionHistory?.[credential.versionHistory.length - 1]?.reason ? `: ${credential.versionHistory[credential.versionHistory.length - 1].reason}` : ""}`,
    });
  }

  // Expiry
  if (credential.expiresAt && credential.expiresAt > 0) {
    const now = Date.now() / 1000;
    events.push({
      id: `expiry-${credential.id}`,
      type: "expired",
      timestamp: credential.expiresAt,
      label: credential.expiresAt < now ? "Expired" : "Expires",
      detail: `${credential.expiresAt < now ? "Expired" : "Expires"} on ${formatTimestamp(credential.expiresAt)}`,
    });
  }

  // Revocation
  if (credential.revoked) {
    // Use issuedAt as a fallback since the Credential type does not carry revokedAt.
    const revokedTs = credential.issuedAt ?? 0;
    events.push({
      id: `revoked-${credential.id}`,
      type: "revoked",
      timestamp: revokedTs,
      label: "Revoked",
      detail: `Credential was revoked`,
    });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CredentialTimeline({
  credential,
  verifiedAt = [],
  events,
  network = "testnet",
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: Props) {
  if (events !== undefined) {
    return (
      <ActivityFeed
        events={events}
        network={network}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        loadingMore={loadingMore}
      />
    );
  }

  if (!credential) {
    return null;
  }

  return <SingleCredentialTimeline credential={credential} verifiedAt={verifiedAt} />;
}

// ── Single-credential horizontal timeline ─────────────────────────────────────

function SingleCredentialTimeline({
  credential,
  verifiedAt,
}: {
  credential: Credential;
  verifiedAt: number[];
}) {
  const allEvents = buildEvents(credential, verifiedAt);

  const [activeFilters, setActiveFilters] = useState<Set<TimelineEventType>>(
    new Set(ALL_EVENT_TYPES),
  );
  const [tooltip, setTooltip] = useState<{ event: TimelineEvent; x: number; y: number } | null>(null);
  const [pan, setPan] = useState(0);          // px offset along time axis
  const [zoom, setZoom] = useState(1);        // 1 = 100%
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const panAtDragStart = useRef(0);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);

  const filteredEvents = allEvents.filter((e) => activeFilters.has(e.type));

  // Derive min/max timestamps for positioning
  const timestamps = filteredEvents.map((e) => e.timestamp).filter(Boolean);
  const minTs = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length ? Math.max(...timestamps) : 1;
  const span = Math.max(maxTs - minTs, 1);

  const toggleFilter = useCallback((type: TimelineEventType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev; // keep at least one active
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setPan(0);
  }, []);

  // Wheel → zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => Math.min(Math.max(z + delta, 0.5), 8));
  }, []);

  // Mouse drag → pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    panAtDragStart.current = pan;
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStartX.current;
    setPan(panAtDragStart.current + dx);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Touch drag → pan
  const touchStartX = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    panAtDragStart.current = pan;
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    setPan(panAtDragStart.current + dx);
  }, []);

  // Reset pan/zoom when credential changes
  useEffect(() => {
    setPan(0);
    setZoom(1);
    setTooltip(null);
  }, [credential.id]);

  // ── Export as image ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const canvas = exportCanvasRef.current;
    if (!canvas) return;

    const W = 800;
    const H = 160;
    const PAD = 60;
    const MID_Y = H / 2;
    const DOT_R = 10;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    // Timeline axis
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, MID_Y);
    ctx.lineTo(W - PAD, MID_Y);
    ctx.stroke();

    if (!filteredEvents.length) {
      ctx.fillStyle = "#aaa";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No events", W / 2, MID_Y);
    } else {
      filteredEvents.forEach((ev) => {
        const frac = span > 0 ? (ev.timestamp - minTs) / span : 0.5;
        const x = PAD + frac * (W - PAD * 2);
        const isAbove = filteredEvents.indexOf(ev) % 2 === 0;
        const labelY = isAbove ? MID_Y - 30 : MID_Y + 30;

        // Connector line
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, MID_Y);
        ctx.lineTo(x, labelY + (isAbove ? DOT_R : -DOT_R));
        ctx.stroke();

        // Circle
        const colorMap: Record<TimelineEventType, string> = {
          issued: "#6c63ff",
          verified: "#28a745",
          expired: "#ffc107",
          revoked: "#dc3545",
          amended: "#17a2b8",
        };
        ctx.fillStyle = colorMap[ev.type];
        ctx.beginPath();
        ctx.arc(x, MID_Y, DOT_R, 0, Math.PI * 2);
        ctx.fill();

        // Icon text inside circle
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(EVENT_ICONS[ev.type], x, MID_Y);

        // Label below/above
        ctx.fillStyle = "#ddd";
        ctx.font = "11px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(ev.label, x, labelY);
      });
    }

    const link = document.createElement("a");
    link.download = `credential-timeline-${credential.id.slice(0, 8)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [filteredEvents, credential.id, minTs, span]);

  // ── Render ────────────────────────────────────────────────────────────────

  const trackWidth = `${Math.round(zoom * 100)}%`;

  return (
    <div
      style={{
        background: "var(--card-bg, #16213e)",
        borderRadius: "0.75rem",
        padding: "1rem",
        marginTop: "0.75rem",
      }}
      aria-label="Credential lifecycle timeline"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>
          Timeline
        </h4>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }} role="group" aria-label="Filter timeline events">
          {ALL_EVENT_TYPES.map((type) => {
            const active = activeFilters.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleFilter(type)}
                aria-pressed={active}
                title={`${active ? "Hide" : "Show"} ${EVENT_LABELS[type]} events`}
                style={{
                  padding: "0.2rem 0.6rem",
                  borderRadius: "999px",
                  border: `2px solid ${EVENT_COLORS[type]}`,
                  background: active ? EVENT_BG[type] : "transparent",
                  color: active ? EVENT_COLORS[type] : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {EVENT_ICONS[type]} {EVENT_LABELS[type]}
              </button>
            );
          })}
        </div>

        {/* Export button */}
        <button
          type="button"
          onClick={handleExport}
          title="Export timeline as PNG"
          style={{
            padding: "0.2rem 0.7rem",
            borderRadius: "0.35rem",
            border: "1px solid var(--border-input)",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "0.75rem",
          }}
        >
          ⬇ Export
        </button>
      </div>

      {/* Zoom hint */}
      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
        Scroll to zoom · Drag to pan
      </p>

      {/* Scrollable track */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        style={{
          overflow: "hidden",
          cursor: isDragging.current ? "grabbing" : "grab",
          userSelect: "none",
          position: "relative",
          height: "120px",
        }}
        aria-label="Timeline track — scroll to zoom, drag to pan"
      >
        <div
          ref={trackRef}
          style={{
            width: trackWidth,
            minWidth: "100%",
            position: "relative",
            height: "100%",
            transform: `translateX(${pan}px)`,
            transition: isDragging.current ? "none" : "transform 0.15s ease",
          }}
        >
          {/* Horizontal axis */}
          <div
            style={{
              position: "absolute",
              left: "2%",
              right: "2%",
              top: "50%",
              height: "2px",
              background: "var(--border-input, #333)",
              transform: "translateY(-50%)",
            }}
            aria-hidden="true"
          />

          {/* Events */}
          {filteredEvents.length === 0 && (
            <p
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                color: "var(--text-muted)",
                fontSize: "0.8rem",
                margin: 0,
              }}
            >
              No events match the selected filters.
            </p>
          )}

          {filteredEvents.map((ev, idx) => {
            const frac = span > 0 ? (ev.timestamp - minTs) / span : 0.5;
            const leftPct = 4 + frac * 92; // 4%..96%
            const isAbove = idx % 2 === 0;

            return (
              <div
                key={ev.id}
                role="listitem"
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                {/* Connector */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: isAbove ? "unset" : "100%",
                    bottom: isAbove ? "100%" : "unset",
                    left: "50%",
                    width: "1px",
                    height: "22px",
                    background: "var(--border-input)",
                    transform: "translateX(-50%)",
                  }}
                />

                {/* Label (alternating above / below) */}
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: isAbove ? "unset" : "calc(100% + 26px)",
                    bottom: isAbove ? "calc(100% + 26px)" : "unset",
                    fontSize: "0.65rem",
                    color: EVENT_COLORS[ev.type],
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                  }}
                >
                  {ev.label}
                </span>

                {/* Dot */}
                <button
                  type="button"
                  aria-label={`${ev.label}: ${ev.detail}`}
                  title={ev.detail}
                  onClick={(e) => {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setTooltip(
                      tooltip?.event.id === ev.id
                        ? null
                        : { event: ev, x: rect.left + rect.width / 2, y: rect.top },
                    );
                  }}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    border: `3px solid ${EVENT_COLORS[ev.type]}`,
                    background: EVENT_BG[ev.type],
                    color: EVENT_COLORS[ev.type],
                    cursor: "pointer",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow:
                      tooltip?.event.id === ev.id
                        ? `0 0 0 3px ${EVENT_COLORS[ev.type]}44`
                        : "none",
                    transition: "box-shadow 0.15s",
                  }}
                >
                  {EVENT_ICONS[ev.type]}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          role="tooltip"
          aria-live="polite"
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 0.8rem",
            borderRadius: "0.4rem",
            background: EVENT_BG[tooltip.event.type],
            border: `1px solid ${EVENT_COLORS[tooltip.event.type]}`,
            color: EVENT_COLORS[tooltip.event.type],
            fontSize: "0.8rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <span>
            <strong>{tooltip.event.label}</strong> — {tooltip.event.detail}
            {tooltip.event.timestamp > 0 && (
              <span style={{ marginLeft: "0.5rem", opacity: 0.75 }}>
                ({formatTimestamp(tooltip.event.timestamp)})
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setTooltip(null)}
            aria-label="Dismiss tooltip"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
              color: "inherit",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Hidden canvas for PNG export */}
      <canvas ref={exportCanvasRef} style={{ display: "none" }} aria-hidden="true" />
    </div>
  );
}

// ── Activity feed (vertical timeline) ─────────────────────────────────────────

interface ActivityFeedProps {
  events: StreamedContractEvent[];
  network: string;
  onLoadMore?: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}

function ActivityFeed({ events, network, onLoadMore, hasMore, loadingMore }: ActivityFeedProps) {
  const [activeFilters, setActiveFilters] = useState<Set<ActivityType>>(
    new Set(ACTIVITY_TYPES),
  );
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const toggleFilter = useCallback((type: ActivityType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev; // keep at least one active
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = fromDate ? new Date(fromDate).getTime() / 1000 : null;
    const toTs = toDate ? new Date(toDate).getTime() / 1000 + 86399 : null;

    return events
      .map((ev) => ({ ev, type: normalizeActivityType(ev.type) }))
      .filter((entry): entry is { ev: StreamedContractEvent; type: ActivityType } => entry.type !== null)
      .filter(({ ev, type }) => {
        if (!activeFilters.has(type)) return false;
        if (fromTs !== null && ev.timestamp < fromTs) return false;
        if (toTs !== null && ev.timestamp > toTs) return false;
        if (q) {
          const haystack = [
            ev.credentialId,
            ev.subject,
            ev.issuer,
            ev.txHash,
            ev.detail,
            ev.type,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.ev.timestamp - a.ev.timestamp); // newest first
  }, [events, activeFilters, search, fromDate, toDate]);

  // Infinite scroll: trigger onLoadMore when the sentinel becomes visible.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !onLoadMore || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loadingMore]);

  const handleExport = useCallback(
    (format: "csv" | "json") => {
      const rows = visibleEvents.map(({ ev, type }) => ({
        type,
        timestamp: ev.timestamp,
        timestampIso: new Date(ev.timestamp * 1000).toISOString(),
        credentialId: ev.credentialId ?? "",
        subject: ev.subject ?? "",
        issuer: ev.issuer ?? "",
        txHash: ev.txHash ?? "",
        gasCost: ev.gasCost ?? "",
        ledger: ev.ledger ?? "",
        detail: ev.detail ?? "",
      }));

      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "json") {
        downloadFile(
          `activity-feed-${stamp}.json`,
          JSON.stringify(rows, null, 2),
          "application/json",
        );
      } else {
        const headers = [
          "type",
          "timestamp",
          "timestampIso",
          "credentialId",
          "subject",
          "issuer",
          "txHash",
          "gasCost",
          "ledger",
          "detail",
        ];
        const lines = [headers.join(",")];
        for (const row of rows) {
          lines.push(
            headers
              .map((h) => csvEscape(String((row as Record<string, unknown>)[h] ?? "")))
              .join(","),
          );
        }
        downloadFile(`activity-feed-${stamp}.csv`, lines.join("\n"), "text/csv");
      }
    },
    [visibleEvents],
  );

  return (
    <div
      style={{
        background: "var(--card-bg, #16213e)",
        borderRadius: "0.75rem",
        padding: "1rem",
        marginTop: "0.75rem",
      }}
      aria-label="Activity feed"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>Activity</h4>

        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button
            type="button"
            onClick={() => handleExport("csv")}
            title="Export visible activity as CSV"
            style={exportBtnStyle}
          >
            ⬇ CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport("json")}
            title="Export visible activity as JSON"
            style={exportBtnStyle}
          >
            ⬇ JSON
          </button>
        </div>
      </div>

      {/* Type filter chips */}
      <div
        style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.6rem" }}
        role="group"
        aria-label="Filter activity by type"
      >
        {ACTIVITY_TYPES.map((type) => {
          const active = activeFilters.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleFilter(type)}
              aria-pressed={active}
              title={`${active ? "Hide" : "Show"} ${type} activity`}
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                border: `2px solid ${ACTIVITY_COLORS[type]}`,
                background: active ? ACTIVITY_BG[type] : "transparent",
                color: active ? ACTIVITY_COLORS[type] : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.75rem",
                fontWeight: active ? 600 : 400,
              }}
            >
              {ACTIVITY_ICONS[type]} {type}
            </button>
          );
        })}
      </div>

      {/* Search + date range */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search hash, credential, address…"
          aria-label="Search activity"
          style={inputStyle}
        />
        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          From{" "}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          To{" "}
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            style={inputStyle}
          />
        </label>
      </div>

      {/* Vertical timeline */}
      {visibleEvents.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
          No activity matches the selected filters.
        </p>
      ) : (
        <ol
          role="list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            position: "relative",
            borderLeft: "2px solid var(--border-input, #333)",
            marginLeft: "0.5rem",
          }}
        >
          {visibleEvents.map(({ ev, type }, idx) => {
            const gas = formatGas(ev.gasCost);
            return (
              <li
                key={ev.id ?? `${ev.txHash ?? "ev"}-${ev.timestamp}-${idx}`}
                style={{ position: "relative", padding: "0 0 0.9rem 1rem" }}
              >
                {/* Dot */}
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "-0.6rem",
                    top: "0.15rem",
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    border: `2px solid ${ACTIVITY_COLORS[type]}`,
                    background: ACTIVITY_BG[type],
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.55rem",
                    color: ACTIVITY_COLORS[type],
                    fontWeight: 700,
                  }}
                >
                  {ACTIVITY_ICONS[type]}
                </span>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      padding: "0.05rem 0.5rem",
                      borderRadius: "999px",
                      background: ACTIVITY_BG[type],
                      color: ACTIVITY_COLORS[type],
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {type}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    {formatTimestamp(ev.timestamp)}
                  </span>
                  {gas && (
                    <span
                      style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}
                      title="Gas cost"
                    >
                      ⛽ {gas}
                    </span>
                  )}
                </div>

                {(ev.credentialId || ev.detail) && (
                  <div style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>
                    {ev.detail ?? `Credential ${ev.credentialId?.slice(0, 10)}…`}
                  </div>
                )}

                {ev.txHash && (
                  <a
                    href={explorerTxUrl(network, ev.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--accent-light, #6c63ff)",
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                    }}
                    title="View transaction on Stellar explorer"
                  >
                    {ev.txHash.slice(0, 10)}…{ev.txHash.slice(-6)} ↗
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: "1px" }} />
      {loadingMore && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", margin: "0.5rem 0 0" }}>
          Loading more…
        </p>
      )}
      {!hasMore && visibleEvents.length > 0 && (
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center", margin: "0.5rem 0 0" }}>
          End of history
        </p>
      )}
    </div>
  );
}

const exportBtnStyle: React.CSSProperties = {
  padding: "0.2rem 0.7rem",
  borderRadius: "0.35rem",
  border: "1px solid var(--border-input)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: "0.75rem",
};

const inputStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.35rem",
  border: "1px solid var(--border-input)",
  background: "transparent",
  color: "inherit",
  fontSize: "0.75rem",
};
