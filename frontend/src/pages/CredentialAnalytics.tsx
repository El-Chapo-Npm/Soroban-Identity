import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AreaChart,
  Area,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DateRange {
  start: string; // ISO date (YYYY-MM-DD)
  end: string; // ISO date (YYYY-MM-DD)
}

type RangePreset = '7d' | '30d' | '90d' | 'custom';

interface IssuanceTrendPoint {
  date: string;
  issued: number;
  revoked: number;
}

interface VerificationRatePoint {
  date: string;
  success: number;
  failure: number;
}

interface CredentialTypePoint {
  type: string;
  count: number;
}

interface IssuerPerformancePoint {
  issuer: string;
  issued: number;
  verified: number;
  successRate: number;
}

interface GeoUsagePoint {
  region: string;
  country: string;
  count: number;
  lat?: number;
  lng?: number;
}

interface AnalyticsSummary {
  totalIssued: number;
  totalVerified: number;
  verificationSuccessRate: number;
  activeCredentials: number;
  issuanceTrends: IssuanceTrendPoint[];
  verificationRates: VerificationRatePoint[];
  popularTypes: CredentialTypePoint[];
  issuerPerformance: IssuerPerformancePoint[];
  geoUsage: GeoUsagePoint[];
  generatedAt: string;
}

interface AnalyticsReport {
  range: DateRange;
  summary: AnalyticsSummary;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/analytics';
const WS_URL =
  (typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'wss://'
    : 'ws://') +
  (typeof window !== 'undefined' ? window.location.host : 'localhost') +
  '/api/analytics/stream';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for historical data
const CACHE_PREFIX = 'credential-analytics:';

const CHART_COLORS = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<RangePreset, 'custom'>): DateRange {
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: toISODate(start), end: toISODate(end) };
}

function rangeKey(range: DateRange): string {
  return `${range.start}_${range.end}`;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore quota / serialization errors.
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Real-time hook (WebSocket with SSE fallback)
// ---------------------------------------------------------------------------

function useRealtimeAnalytics(
  onUpdate: (summary: AnalyticsSummary) => void,
  enabled: boolean,
): { connected: boolean; error: string | null } {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const handleMessage = (raw: string) => {
      try {
        const payload = JSON.parse(raw);
        const summary: AnalyticsSummary | undefined =
          payload?.summary ?? payload?.data ?? payload;
        if (summary && Array.isArray(summary.issuanceTrends)) {
          onUpdateRef.current(summary);
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    const connectSSE = () => {
      try {
        es = new EventSource(`${API_BASE}/stream`);
        es.onopen = () => {
          setConnected(true);
          setError(null);
        };
        es.onmessage = (ev) => handleMessage(ev.data);
        es.onerror = () => {
          setConnected(false);
          setError('Real-time connection lost. Retrying…');
          es?.close();
          es = null;
          if (!closed) {
            reconnectTimer = setTimeout(connectSSE, 5000);
          }
        };
      } catch {
        setError('Unable to establish real-time connection.');
      }
    };

    const connectWS = () => {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
          setConnected(true);
          setError(null);
        };
        ws.onmessage = (ev) => handleMessage(ev.data);
        ws.onerror = () => {
          setError('Real-time connection error.');
        };
        ws.onclose = () => {
          setConnected(false);
          ws = null;
          if (!closed) {
            reconnectTimer = setTimeout(connectWS, 5000);
          }
        };
      } catch {
        // Fall back to SSE.
        connectSSE();
      }
    };

    if (typeof WebSocket !== 'undefined') {
      connectWS();
    } else {
      connectSSE();
    }

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      es?.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected, error };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DateRangePickerProps {
  preset: RangePreset;
  range: DateRange;
  onPresetChange: (preset: RangePreset) => void;
  onRangeChange: (range: DateRange) => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  preset,
  range,
  onPresetChange,
  onRangeChange,
}) => {
  const presets: { key: Exclude<RangePreset, 'custom'>; label: string }[] = [
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: '90d', label: '90 days' },
  ];

  return (
    <div className="analytics-date-range" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPresetChange(p.key)}
          aria-pressed={preset === p.key}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            background: preset === p.key ? '#4f46e5' : '#fff',
            color: preset === p.key ? '#fff' : '#334155',
            cursor: 'pointer',
          }}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPresetChange('custom')}
        aria-pressed={preset === 'custom'}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          background: preset === 'custom' ? '#4f46e5' : '#fff',
          color: preset === 'custom' ? '#fff' : '#334155',
          cursor: 'pointer',
        }}
      >
        Custom
      </button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>From</span>
        <input
          type="date"
          value={range.start}
          max={range.end}
          onChange={(e) => {
            onPresetChange('custom');
            onRangeChange({ ...range, start: e.target.value });
          }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>To</span>
        <input
          type="date"
          value={range.end}
          min={range.start}
          onChange={(e) => {
            onPresetChange('custom');
            onRangeChange({ ...range, end: e.target.value });
          }}
        />
      </label>
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => (
  <div
    className="analytics-stat-card"
    style={{
      flex: '1 1 180px',
      padding: 16,
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      background: '#fff',
    }}
  >
    <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 600, color: '#0f172a' }}>{value}</div>
  </div>
);

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, children }) => (
  <div
    className="analytics-chart-card"
    style={{
      flex: '1 1 420px',
      minWidth: 320,
      padding: 16,
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      background: '#fff',
    }}
  >
    <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#0f172a' }}>{title}</h3>
    <div style={{ width: '100%', height: 280 }}>{children}</div>
  </div>
);

interface GeoHeatMapProps {
  data: GeoUsagePoint[];
}

const GeoHeatMap: React.FC<GeoHeatMapProps> = ({ data }) => {
  const max = useMemo(
    () => data.reduce((m, d) => Math.max(m, d.count), 0) || 1,
    [data],
  );

  if (data.length === 0) {
    return <p style={{ color: '#64748b' }}>No geographic data available.</p>;
  }

  return (
    <div className="analytics-geo-heatmap">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {data
          .slice()
          .sort((a, b) => b.count - a.count)
          .map((point) => {
            const intensity = point.count / max;
            const bg = `rgba(79, 70, 229, ${0.1 + intensity * 0.8})`;
            return (
              <div
                key={`${point.country}-${point.region}`}
                title={`${point.region}, ${point.country}: ${formatNumber(point.count)} uses`}
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: bg,
                  color: intensity > 0.5 ? '#fff' : '#1e293b',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontWeight: 600 }}>{point.region}</span>
                <span style={{ fontSize: 12 }}>{point.country}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{formatNumber(point.count)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function buildCSV(summary: AnalyticsSummary): string {
  const lines: string[] = [];
  lines.push('Section,Metric,Value');
  lines.push(`Summary,Total Issued,${summary.totalIssued}`);
  lines.push(`Summary,Total Verified,${summary.totalVerified}`);
  lines.push(`Summary,Verification Success Rate,${(summary.verificationSuccessRate * 100).toFixed(2)}%`);
  lines.push(`Summary,Active Credentials,${summary.activeCredentials}`);
  lines.push('');
  lines.push('Issuance Trends,Date,Issued,Revoked');
  summary.issuanceTrends.forEach((p) => lines.push(`Issuance Trends,${p.date},${p.issued},${p.revoked}`));
  lines.push('');
  lines.push('Verification Rates,Date,Success,Failure');
  summary.verificationRates.forEach((p) => lines.push(`Verification Rates,${p.date},${p.success},${p.failure}`));
  lines.push('');
  lines.push('Popular Types,Type,Count');
  summary.popularTypes.forEach((p) => lines.push(`Popular Types,${p.type},${p.count}`));
  lines.push('');
  lines.push('Issuer Performance,Issuer,Issued,Verified,Success Rate');
  summary.issuerPerformance.forEach((p) =>
    lines.push(`Issuer Performance,${p.issuer},${p.issued},${p.verified},${(p.successRate * 100).toFixed(2)}%`),
  );
  lines.push('');
  lines.push('Geographic Usage,Region,Country,Count');
  summary.geoUsage.forEach((p) => lines.push(`Geographic Usage,${p.region},${p.country},${p.count}`));
  return lines.join('\n');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CredentialAnalytics: React.FC = () => {
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'));
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [realtimeEnabled, setRealtimeEnabled] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const handlePresetChange = useCallback((next: RangePreset) => {
    setPreset(next);
    if (next !== 'custom') {
      setRange(presetRange(next));
    }
  }, []);

  // Fetch aggregated summary for the selected range (with client-side cache).
  useEffect(() => {
    let cancelled = false;
    const key = rangeKey(range);

    const cached = readCache<AnalyticsSummary>(key);
    if (cached) {
      setSummary(cached);
      setLastUpdated(cached.generatedAt ?? null);
    }

    const fetchSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ start: range.start, end: range.end });
        const res = await fetch(`${API_BASE}/summary?${params.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Failed to load analytics (${res.status})`);
        }
        const data: AnalyticsSummary = await res.json();
        if (cancelled) return;
        setSummary(data);
        setLastUpdated(data.generatedAt ?? new Date().toISOString());
        writeCache(key, data);
      } catch (err) {
        if (cancelled) return;
        if (!cached) {
          setError(err instanceof Error ? err.message : 'Failed to load analytics');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSummary();

    return () => {
      cancelled = true;
    };
  }, [range]);

  // Real-time updates.
  const handleRealtimeUpdate = useCallback((next: AnalyticsSummary) => {
    setSummary(next);
    setLastUpdated(next.generatedAt ?? new Date().toISOString());
  }, []);

  const { connected, error: realtimeError } = useRealtimeAnalytics(
    handleRealtimeUpdate,
    realtimeEnabled,
  );

  // Export handlers.
  const handleExportCSV = useCallback(() => {
    if (!summary) return;
    const csv = buildCSV(summary);
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `credential-analytics_${range.start}_${range.end}.csv`,
    );
  }, [summary, range]);

  const handleExportPDF = useCallback(async () => {
    if (!summary) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start: range.start,
        end: range.end,
        format: 'pdf',
      });
      const res = await fetch(`${API_BASE}/reports?${params.toString()}`, {
        headers: { Accept: 'application/pdf' },
      });
      if (!res.ok) {
        throw new Error(`Failed to generate PDF report (${res.status})`);
      }
      const blob = await res.blob();
      downloadBlob(blob, `credential-analytics_${range.start}_${range.end}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }, [summary, range]);

  // Derived chart data.
  const verificationChartData = useMemo(() => {
    if (!summary) return [];
    return summary.verificationRates.map((p) => {
      const total = p.success + p.failure;
      return {
        date: p.date,
        success: p.success,
        failure: p.failure,
        successRate: total > 0 ? p.success / total : 0,
      };
    });
  }, [summary]);

  const issuerChartData = useMemo(() => {
    if (!summary) return [];
    return summary.issuerPerformance.map((p) => ({
      ...p,
      successRatePct: Number((p.successRate * 100).toFixed(1)),
    }));
  }, [summary]);

  return (
    <div className="credential-analytics-page" style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Credential Analytics</h1>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
              Usage patterns, verification trends, and issuer performance.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              title={connected ? 'Real-time updates active' : 'Real-time updates disconnected'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: connected ? '#059669' : '#b91c1c',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: connected ? '#10b981' : '#ef4444',
                  display: 'inline-block',
                }}
              />
              {connected ? 'Live' : 'Offline'}
            </span>
            <button
              type="button"
              onClick={() => setRealtimeEnabled((v) => !v)}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
            >
              {realtimeEnabled ? 'Pause live' : 'Resume live'}
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!summary}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: summary ? 'pointer' : 'not-allowed' }}
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={!summary || exporting}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff', cursor: summary && !exporting ? 'pointer' : 'not-allowed' }}
            >
              {exporting ? 'Generating…' : 'Export PDF'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <DateRangePicker
            preset={preset}
            range={range}
            onPresetChange={handlePresetChange}
            onRangeChange={setRange}
          />
        </div>
      </header>

      {error && (
        <div role="alert" style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}
      {realtimeError && !error && (
        <div role="status" style={{ padding: 8, marginBottom: 16, borderRadius: 6, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', fontSize: 13 }}>
          {realtimeError}
        </div>
      )}

      {loading && !summary && (
        <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading analytics…</div>
      )}

      {summary && (
        <>
          <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Total Issued" value={formatNumber(summary.totalIssued)} />
            <StatCard label="Total Verified" value={formatNumber(summary.totalVerified)} />
            <StatCard label="Verification Success" value={formatPercent(summary.verificationSuccessRate)} />
            <StatCard label="Active Credentials" value={formatNumber(summary.activeCredentials)} />
          </section>

          <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <ChartCard title="Credential Issuance Trends">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.issuanceTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="issued" stroke="#4f46e5" fill="#c7d2fe" name="Issued" />
                  <Area type="monotone" dataKey="revoked" stroke="#ef4444" fill="#fecaca" name="Revoked" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Verification Success / Failure">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={verificationChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="success" stroke="#10b981" name="Success" dot={false} />
                  <Line type="monotone" dataKey="failure" stroke="#ef4444" name="Failure" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <ChartCard title="Most Popular Credential Types">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.popularTypes}
                    dataKey="count"
                    nameKey="type"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(entry: CredentialTypePoint) => entry.type}
                  >
                    {summary.popularTypes.map((entry, index) => (
                      <Cell key={entry.type} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Issuer Performance">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={issuerChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="issuer" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="issued" fill="#4f46e5" name="Issued" />
                  <Bar yAxisId="left" dataKey="verified" fill="#0ea5e9" name="Verified" />
                  <Bar yAxisId="right" dataKey="successRatePct" fill="#10b981" name="Success Rate (%)" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section style={{ marginBottom: 16 }}>
            <div
              className="analytics-chart-card"
              style={{ padding: 16, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff' }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#0f172a' }}>Geographic Credential Usage</h3>
              <GeoHeatMap data={summary.geoUsage} />
            </div>
          </section>

          <footer style={{ fontSize: 12, color: '#94a3b8' }}>
            {lastUpdated && <span>Last updated: {new Date(lastUpdated).toLocaleString()}</span>}
          </footer>
        </>
      )}
    </div>
  );
};

export default CredentialAnalytics;