import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { ScoreHistoryEntry } from "../../../sdk/src/reputation";

/**
 * Reputation Score Visualization Dashboard (#711)
 * 
 * Comprehensive dashboard for viewing and analyzing reputation scores with:
 * - Score gauge/meter visualization
 * - Historical trends
 * - Category breakdown
 * - Network comparison
 * - Recent events
 * - Score prediction
 * - PDF export
 */

interface ReputationEvent {
  id: string;
  type: "increase" | "decrease" | "milestone" | "alert";
  title: string;
  description: string;
  delta: number;
  timestamp: number;
}

interface CategoryScore {
  name: string;
  score: number;
  weight: number;
  trend: number;
}

interface ReputationDashboardProps {
  currentScore: number;
  networkAverage?: number;
  history: ScoreHistoryEntry[];
  categories?: CategoryScore[];
  recentEvents?: ReputationEvent[];
  isLoading?: boolean;
}

// Score gauge component
function ScoreGauge({ score, max = 100, networkAverage }: { score: number; max?: number; networkAverage?: number }) {
  const percentage = (score / max) * 100;
  const rotation = (percentage / 100) * 180 - 90;
  
  const getScoreColor = (s: number) => {
    if (s >= 80) return "#10b981"; // green
    if (s >= 60) return "#f59e0b"; // amber
    if (s >= 40) return "#ef4444"; // red
    return "#7f1d1d"; // dark red
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1rem",
        padding: "1.5rem",
        background: "var(--card-bg)",
        borderRadius: "0.5rem",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "1rem" }}>Reputation Score</h3>
      
      <div style={{ position: "relative", width: "150px", height: "150px" }}>
        {/* Gauge background */}
        <svg width="150" height="150" style={{ position: "absolute", top: 0, left: 0 }}>
          <circle cx="75" cy="75" r="60" fill="none" stroke="var(--border-input)" strokeWidth="8" />
          <circle
            cx="75"
            cy="75"
            r="60"
            fill="none"
            stroke={getScoreColor(score)}
            strokeWidth="8"
            strokeDasharray={`${(percentage / 100) * 376.99} 376.99`}
            style={{ transition: "stroke-dasharray 0.3s ease" }}
          />
        </svg>
        
        {/* Center text */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: getScoreColor(score) }}>
            {score}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>out of {max}</div>
        </div>
      </div>

      {networkAverage !== undefined && (
        <div style={{ textAlign: "center", fontSize: "0.85rem" }}>
          <div style={{ color: "var(--text-muted)" }}>Network Average</div>
          <div style={{ fontWeight: "bold", color: "var(--text)" }}>{networkAverage.toFixed(1)}</div>
          <div style={{ color: score > networkAverage ? "var(--success, #10b981)" : "var(--error, #ef4444)", fontSize: "0.75rem" }}>
            {score > networkAverage ? "+" : ""}{(score - networkAverage).toFixed(1)} vs average
          </div>
        </div>
      )}
    </div>
  );
}

// Category breakdown component
function CategoryBreakdown({ categories }: { categories: CategoryScore[] }) {
  const data = categories.map((c) => ({
    name: c.name,
    value: c.score,
    weight: c.weight,
  }));

  const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1.5rem",
        background: "var(--card-bg)",
        borderRadius: "0.5rem",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "1rem" }}>Score Breakdown by Category</h3>
      
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => `${value.toFixed(1)}`}
            contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-input)" }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
        {categories.map((cat, i) => (
          <div
            key={cat.name}
            style={{
              padding: "0.75rem",
              background: "var(--card-bg-accent)",
              borderRadius: "0.4rem",
              borderLeft: `3px solid ${COLORS[i % COLORS.length]}`,
            }}
          >
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{cat.name}</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>{cat.score.toFixed(1)}</div>
            <div style={{ fontSize: "0.75rem", color: cat.trend > 0 ? "var(--success, #10b981)" : "var(--error, #ef4444)" }}>
              {cat.trend > 0 ? "↑" : "↓"} {Math.abs(cat.trend).toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Trend prediction component
function ScorePrediction({ history, networkAverage }: { history: ScoreHistoryEntry[]; networkAverage?: number }) {
  const { predictedScore, trend, confidence } = useMemo(() => {
    if (history.length < 2) {
      return { predictedScore: 0, trend: 0, confidence: 0 };
    }

    const recent = history.slice(-10);
    const deltas = recent.map((e) => e.delta);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const currentScore = recent[recent.length - 1].score || 0;
    const predictedScore = Math.max(0, Math.min(100, currentScore + avgDelta * 7)); // 7 days prediction

    // Calculate confidence based on consistency
    const variance = deltas.reduce((acc, d) => acc + Math.pow(d - avgDelta, 2), 0) / deltas.length;
    const stdDev = Math.sqrt(variance);
    const confidence = Math.max(0, 100 - stdDev * 2);

    return { predictedScore, trend: avgDelta, confidence };
  }, [history]);

  return (
    <div
      style={{
        padding: "1.5rem",
        background: "var(--card-bg)",
        borderRadius: "0.5rem",
      }}
    >
      <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>7-Day Score Prediction</h3>
      
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Predicted Score</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
            {predictedScore.toFixed(1)}
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Trend</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: trend > 0 ? "var(--success, #10b981)" : "var(--error, #ef4444)" }}>
            {trend > 0 ? "+" : ""}{trend.toFixed(2)}
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Confidence</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
            {confidence.toFixed(0)}%
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
          Prediction confidence
        </div>
        <div
          style={{
            width: "100%",
            height: "8px",
            background: "var(--border-input)",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${confidence}%`,
              background: confidence > 70 ? "var(--success, #10b981)" : "var(--warning, #f59e0b)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Recent events component
function RecentEvents({ events }: { events: ReputationEvent[] }) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case "increase": return "📈";
      case "decrease": return "📉";
      case "milestone": return "🎯";
      case "alert": return "⚠️";
      default: return "•";
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "increase": return "var(--success, #10b981)";
      case "decrease": return "var(--error, #ef4444)";
      case "milestone": return "var(--accent-light, #3b82f6)";
      case "alert": return "var(--warning, #f59e0b)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div
      style={{
        padding: "1.5rem",
        background: "var(--card-bg)",
        borderRadius: "0.5rem",
      }}
    >
      <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Recent Events</h3>
      
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {events.slice(0, 5).map((event) => (
          <div
            key={event.id}
            style={{
              padding: "0.75rem",
              background: "var(--card-bg-accent)",
              borderRadius: "0.4rem",
              borderLeft: `3px solid ${getEventColor(event.type)}`,
              display: "flex",
              gap: "0.75rem",
            }}
          >
            <div style={{ fontSize: "1.2rem" }}>{getEventIcon(event.type)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>{event.title}</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {event.description}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {new Date(event.timestamp * 1000).toLocaleString()}
              </div>
            </div>
            <div style={{ fontSize: "1rem", fontWeight: "bold", color: event.delta > 0 ? "var(--success, #10b981)" : "var(--error, #ef4444)" }}>
              {event.delta > 0 ? "+" : ""}{event.delta.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// PDF export utility
function exportToPDF(dashboardData: ReputationDashboardProps) {
  const content = `
REPUTATION SCORE REPORT
Generated: ${new Date().toLocaleString()}

Current Score: ${dashboardData.currentScore}
${dashboardData.networkAverage ? `Network Average: ${dashboardData.networkAverage.toFixed(1)}` : ""}

SCORE BREAKDOWN
${dashboardData.categories?.map((c) => `${c.name}: ${c.score.toFixed(1)} (${c.weight}%)`).join("\n")}

RECENT EVENTS
${dashboardData.recentEvents?.slice(0, 10).map((e) => `${e.title}: ${e.delta > 0 ? "+" : ""}${e.delta.toFixed(1)}`).join("\n")}

HISTORY (Last 30 entries)
${dashboardData.history.slice(-30).map((e) => `${new Date(e.submittedAt * 1000).toLocaleDateString()}: ${e.score.toFixed(1)} (${e.delta > 0 ? "+" : ""}${e.delta.toFixed(1)})`).join("\n")}
  `;

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reputation-report-${new Date().toISOString().split("T")[0]}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// Main dashboard component
export default function ReputationDashboard({
  currentScore,
  networkAverage = 65,
  history = [],
  categories = [
    { name: "Verification", score: 85, weight: 30, trend: 2 },
    { name: "Reliability", score: 75, weight: 25, trend: -1 },
    { name: "Activity", score: 90, weight: 20, trend: 3 },
    { name: "Compliance", score: 70, weight: 15, trend: 0 },
    { name: "Community", score: 80, weight: 10, trend: 1 },
  ],
  recentEvents = [],
  isLoading = false,
}: ReputationDashboardProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>("gauge");

  if (isLoading) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        Loading reputation data...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Score gauge and key metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem" }}>
        <ScoreGauge score={currentScore} networkAverage={networkAverage} />
        {categories.length > 0 && <CategoryBreakdown categories={categories} />}
      </div>

      {/* Trends and prediction */}
      {history.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem" }}>
          <ScorePrediction history={history} networkAverage={networkAverage} />
          
          {/* Trends line chart */}
          <div
            style={{
              padding: "1.5rem",
              background: "var(--card-bg)",
              borderRadius: "0.5rem",
            }}
          >
            <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Score Trend (Last 30 Days)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={history.slice(-30)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-input)" />
                <XAxis
                  dataKey="submittedAt"
                  tickFormatter={(ts) =>
                    new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  }
                  tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-input)" }}
                  labelFormatter={(ts) => new Date(ts * 1000).toLocaleString()}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--accent-light, #3b82f6)"
                  dot={false}
                  isAnimationActive={true}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && <RecentEvents events={recentEvents} />}

      {/* Export button */}
      <button
        onClick={() => exportToPDF({ currentScore, networkAverage, history, categories, recentEvents, isLoading })}
        style={{
          padding: "0.75rem 1.5rem",
          background: "var(--accent-light, #3b82f6)",
          color: "white",
          border: "none",
          borderRadius: "0.4rem",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: "500",
        }}
      >
        📥 Export as Report
      </button>
    </div>
  );
}
