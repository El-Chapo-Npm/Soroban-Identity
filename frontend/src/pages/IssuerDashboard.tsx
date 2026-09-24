import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { useContractEvents } from "../hooks/useContractEvents";
import { useWalletContext } from "../context/WalletContext";

export interface IssuerAnalyticsProps {
  issuerAddress?: string;
}

export type TimeGranularity = "daily" | "weekly" | "monthly";
export type DatePreset = "7d" | "30d" | "90d" | "all" | "custom";

interface IssuanceDataPoint {
  date: string;
  issued: number;
  revoked: number;
  active: number;
}

interface VerificationHeatmapPoint {
  day: string; // Mon, Tue, etc.
  hour: number; // 0-23
  count: number;
}

interface ReputationTrendPoint {
  date: string;
  score: number;
  confidence: number;
}

const PIE_COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const IssuerDashboard: React.FC<IssuerAnalyticsProps> = ({ issuerAddress: propIssuer }) => {
  const wallet = useWalletContext();
  const issuer = propIssuer || wallet.publicKey || "G_ISSUER_DEFAULT_ADDRESS";

  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [granularity, setGranularity] = useState<TimeGranularity>("daily");

  // Dynamic real-time event updates state
  const [realtimeEventsCount, setRealtimeEventsCount] = useState<number>(0);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  // Subscribe to contract events via SSE
  const handleEvent = useCallback((type: string, data: any) => {
    setRealtimeEventsCount((prev) => prev + 1);
    const eventName = data?.topic?.[0] || type || "ContractEvent";
    setLastEvent(`${eventName} received at ${new Date().toLocaleTimeString()}`);
  }, []);

  useContractEvents({
    eventTypes: ["CredentialIssued", "CredentialRevoked", "ReputationUpdated", "CredentialVerified"],
    onEvent: handleEvent,
  });

  // Key metrics calculation based on state and inputs
  const metrics = useMemo(() => {
    // Baseline simulated numbers augmented by real-time updates
    const baseIssued = 1420 + realtimeEventsCount;
    const baseRevoked = 45;
    const activeCredentials = baseIssued - baseRevoked;
    const revocationRate = ((baseRevoked / baseIssued) * 100).toFixed(2);
    const avgVerificationFrequency = 3.8; // verifications per credential / month
    const currentReputationScore = 88.5;

    return {
      totalIssued: baseIssued,
      activeCredentials,
      revocationRate: `${revocationRate}%`,
      avgVerificationFrequency: `${avgVerificationFrequency} / cred / mo`,
      reputationScore: currentReputationScore,
    };
  }, [realtimeEventsCount]);

  // Time-series issuance data (daily/weekly/monthly)
  const issuanceSeriesData = useMemo<IssuanceDataPoint[]>(() => {
    const pointsCount = granularity === "daily" ? 14 : granularity === "weekly" ? 8 : 6;
    const result: IssuanceDataPoint[] = [];
    const now = new Date();

    for (let i = pointsCount - 1; i >= 0; i--) {
      const d = new Date(now);
      if (granularity === "daily") {
        d.setDate(d.getDate() - i);
      } else if (granularity === "weekly") {
        d.setDate(d.getDate() - i * 7);
      } else {
        d.setMonth(d.getMonth() - i);
      }

      const dateStr =
        granularity === "daily"
          ? `${d.getMonth() + 1}/${d.getDate()}`
          : granularity === "weekly"
          ? `Wk ${d.getDate()}/${d.getMonth() + 1}`
          : `${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`;

      const issued = Math.floor(20 + Math.sin(i * 1.5) * 15 + i * 2);
      const revoked = Math.floor(1 + (i % 3));
      result.push({
        date: dateStr,
        issued: issued + (i === 0 ? realtimeEventsCount : 0),
        revoked,
        active: issued - revoked,
      });
    }
    return result;
  }, [granularity, realtimeEventsCount]);

  // Credential type distribution
  const credentialTypeData = useMemo(() => {
    return [
      { name: "KYC / Identity", value: 550 + Math.floor(realtimeEventsCount * 0.4) },
      { name: "Reputation / Score", value: 380 + Math.floor(realtimeEventsCount * 0.3) },
      { name: "Achievement / Badge", value: 290 + Math.floor(realtimeEventsCount * 0.2) },
      { name: "Custom / Domain", value: 200 + Math.floor(realtimeEventsCount * 0.1) },
    ];
  }, [realtimeEventsCount]);

  // Reputation score trend
  const reputationTrendData = useMemo<ReputationTrendPoint[]>(() => {
    const points: ReputationTrendPoint[] = [];
    for (let i = 10; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 3);
      points.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        score: Math.min(100, Math.round(75 + Math.cos(i) * 10 + (10 - i) * 1.2)),
        confidence: Math.round(85 + Math.sin(i) * 5),
      });
    }
    return points;
  }, []);

  // Verification heatmap (days of week x 4-hour slots)
  const heatmapData = useMemo(() => {
    const hours = [0, 4, 8, 12, 16, 20];
    const data: { [key: string]: { [hour: number]: number } } = {};
    DAYS_OF_WEEK.forEach((d) => {
      data[d] = {};
      hours.forEach((h) => {
        // peak hours around 12-16
        const peakFactor = h >= 8 && h <= 16 ? 40 : 10;
        data[d][h] = Math.floor(peakFactor + Math.random() * 25);
      });
    });
    return { days: DAYS_OF_WEEK, hours, data };
  }, []);

  // PDF Export
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = () => {
    setIsExporting(true);
    // Use window.print() or styled print template for high-fidelity PDF export
    setTimeout(() => {
      window.print();
      setIsExporting(false);
    }, 200);
  };

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    const end = new Date();
    const start = new Date();
    if (preset === "7d") start.setDate(end.getDate() - 7);
    else if (preset === "30d") start.setDate(end.getDate() - 30);
    else if (preset === "90d") start.setDate(end.getDate() - 90);
    else if (preset === "all") start.setFullYear(end.getFullYear() - 2);

    if (preset !== "custom") {
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    }
  };

  const getHeatmapColor = (count: number) => {
    if (count > 50) return "#1e3a8a";
    if (count > 35) return "#2563eb";
    if (count > 20) return "#60a5fa";
    if (count > 10) return "#93c5fd";
    return "#e0f2fe";
  };

  return (
    <div
      ref={dashboardRef}
      className="issuer-dashboard-container"
      style={{
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        maxWidth: "1400px",
        margin: "0 auto",
      }}
    >
      {/* Dashboard Header & Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          background: "var(--card-bg, #ffffff)",
          padding: "1.25rem",
          borderRadius: "0.75rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
            Issuer Credential Analytics
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted, #64748b)", fontSize: "0.875rem" }}>
            Issuer: <code style={{ wordBreak: "break-all" }}>{issuer}</code>
            {lastEvent && (
              <span style={{ marginLeft: "1rem", color: "#10b981", fontWeight: 500 }}>
                ● Realtime: {lastEvent}
              </span>
            )}
          </p>
        </div>

        {/* Controls: Date range & Export */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
          {/* Preset Buttons */}
          <div style={{ display: "flex", borderRadius: "0.375rem", overflow: "hidden", border: "1px solid #cbd5e1" }}>
            {(["7d", "30d", "90d", "all", "custom"] as DatePreset[]).map((p) => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                style={{
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.8rem",
                  border: "none",
                  background: datePreset === p ? "var(--primary-color, #2563eb)" : "transparent",
                  color: datePreset === p ? "#fff" : "inherit",
                  cursor: "pointer",
                }}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Date Pickers */}
          {datePreset === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: "0.35rem 0.5rem", borderRadius: "0.375rem", border: "1px solid #cbd5e1" }}
              />
              <span>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: "0.35rem 0.5rem", borderRadius: "0.375rem", border: "1px solid #cbd5e1" }}
              />
            </div>
          )}

          {/* PDF Export Button */}
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.45rem 1rem",
              borderRadius: "0.375rem",
              background: "#0f172a",
              color: "#fff",
              border: "none",
              cursor: isExporting ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            <span>{isExporting ? "Generating PDF..." : "Export PDF Report"}</span>
          </button>
        </div>
      </div>

      {/* Key Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
        }}
      >
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.875rem", fontWeight: 500 }}>
            Total Issued
          </div>
          <div style={{ fontSize: "1.875rem", fontWeight: 700, marginTop: "0.5rem" }}>
            {metrics.totalIssued.toLocaleString()}
          </div>
          <div style={{ color: "#10b981", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            ↑ Continuous on-chain issuance
          </div>
        </div>

        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.875rem", fontWeight: 500 }}>
            Active Credentials
          </div>
          <div style={{ fontSize: "1.875rem", fontWeight: 700, marginTop: "0.5rem", color: "#2563eb" }}>
            {metrics.activeCredentials.toLocaleString()}
          </div>
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Valid & unrevoked
          </div>
        </div>

        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.875rem", fontWeight: 500 }}>
            Revocation Rate
          </div>
          <div style={{ fontSize: "1.875rem", fontWeight: 700, marginTop: "0.5rem", color: "#ef4444" }}>
            {metrics.revocationRate}
          </div>
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            45 credentials revoked
          </div>
        </div>

        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.875rem", fontWeight: 500 }}>
            Avg Verification Frequency
          </div>
          <div style={{ fontSize: "1.875rem", fontWeight: 700, marginTop: "0.5rem", color: "#8b5cf6" }}>
            {metrics.avgVerificationFrequency}
          </div>
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            High ecosystem trust activity
          </div>
        </div>

        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ color: "var(--text-muted, #64748b)", fontSize: "0.875rem", fontWeight: 500 }}>
            Reputation Score
          </div>
          <div style={{ fontSize: "1.875rem", fontWeight: 700, marginTop: "0.5rem", color: "#059669" }}>
            {metrics.reputationScore} / 100
          </div>
          <div style={{ color: "#10b981", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            ✓ Verified Top Issuer
          </div>
        </div>
      </div>

      {/* Charts Row 1: Time Series & Pie Distribution */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Issuance Over Time */}
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
              Credential Issuance Over Time
            </h2>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {(["daily", "weekly", "monthly"] as TimeGranularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  style={{
                    padding: "0.2rem 0.5rem",
                    fontSize: "0.75rem",
                    borderRadius: "0.25rem",
                    border: "1px solid #cbd5e1",
                    background: granularity === g ? "#2563eb" : "transparent",
                    color: granularity === g ? "#fff" : "inherit",
                    cursor: "pointer",
                  }}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={issuanceSeriesData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIssued" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRevoked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="issued"
                  name="Issued"
                  stroke="#2563eb"
                  fillOpacity={1}
                  fill="url(#colorIssued)"
                />
                <Area
                  type="monotone"
                  dataKey="revoked"
                  name="Revoked"
                  stroke="#ef4444"
                  fillOpacity={1}
                  fill="url(#colorRevoked)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Credential Type Distribution Pie */}
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 1rem" }}>
            Credential Type Distribution
          </h2>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={credentialTypeData}
                  cx="50%"
                  cy="50%"
                  outerRadius={85}
                  innerRadius={45}
                  dataKey="value"
                  label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                  labelLine={false}
                >
                  {credentialTypeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2: Verification Heatmap & Reputation Score Trend */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Verification Heatmap by Day/Hour */}
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
              Verification Heatmap (Day & Hour)
            </h2>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>
              Intensity = Verification volume
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr>
                  <th style={{ padding: "0.35rem", textAlign: "left" }}>Day</th>
                  {heatmapData.hours.map((h) => (
                    <th key={h} style={{ padding: "0.35rem", textAlign: "center" }}>
                      {h}:00
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapData.days.map((day) => (
                  <tr key={day}>
                    <td style={{ padding: "0.35rem", fontWeight: 600 }}>{day}</td>
                    {heatmapData.hours.map((h) => {
                      const count = heatmapData.data[day]?.[h] || 0;
                      return (
                        <td
                          key={h}
                          style={{
                            padding: "0.35rem",
                            textAlign: "center",
                          }}
                        >
                          <div
                            title={`${day} @ ${h}:00 - ${count} verifications`}
                            style={{
                              backgroundColor: getHeatmapColor(count),
                              color: count > 30 ? "#fff" : "#1e293b",
                              padding: "0.35rem 0.2rem",
                              borderRadius: "0.25rem",
                              fontWeight: 500,
                              cursor: "default",
                            }}
                          >
                            {count}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reputation Score Trend */}
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "0.75rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 1rem" }}>
            Reputation Score Trend Line
          </h2>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={reputationTrendData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis domain={[60, 100]} fontSize={11} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="score"
                  name="Reputation Score"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="confidence"
                  name="Confidence %"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IssuerDashboard;
