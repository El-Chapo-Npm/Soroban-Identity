import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  Area,
  AreaChart,
} from 'recharts';
import { downloadFile } from '../export/download';

/**
 * NetworkStatistics
 *
 * Renders network-wide DID / credential statistics charts:
 *  - Total DIDs / credentials over time (line chart)
 *  - Top issuers by volume (bar chart)
 *  - Geographic distribution (choropleth-style bar fallback / pie)
 *  - Verification success rate (gauge-style area + line)
 *  - Credential type distribution (pie chart)
 *
 * Includes interactive filters (date range, credential type, issuer),
 * tooltips, and an export-as-image button that serializes the chart
 * container to a PNG using a canvas-based html-to-image approach and
 * reuses `downloadFile` from `frontend/src/export/download.ts`.
 */

export interface NetworkStatisticsProps {
  /** Optional pre-aggregated time series data. */
  timeSeriesData?: TimeSeriesPoint[];
  /** Optional pre-aggregated issuer volume data. */
  issuerData?: IssuerVolume[];
  /** Optional pre-aggregated geographic distribution data. */
  geoData?: GeoDistribution[];
  /** Optional pre-aggregated verification success rate data. */
  verificationData?: VerificationPoint[];
  /** Optional pre-aggregated credential type distribution data. */
  credentialTypeData?: CredentialTypeSlice[];
  /** Optional loading flag. */
  loading?: boolean;
  /** Optional error message. */
  error?: string | null;
  /** Optional callback to refresh data. */
  onRefresh?: () => void;
}

export interface TimeSeriesPoint {
  date: string;
  dids: number;
  credentials: number;
}

export interface IssuerVolume {
  issuer: string;
  volume: number;
}

export interface GeoDistribution {
  region: string;
  count: number;
}

export interface VerificationPoint {
  date: string;
  successRate: number;
  total: number;
}

export interface CredentialTypeSlice {
  type: string;
  count: number;
}

const CHART_COLORS = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#f97316',
];

const DEFAULT_TIME_SERIES: TimeSeriesPoint[] = [
  { date: '2024-01', dids: 120, credentials: 240 },
  { date: '2024-02', dids: 180, credentials: 360 },
  { date: '2024-03', dids: 260, credentials: 520 },
  { date: '2024-04', dids: 340, credentials: 690 },
  { date: '2024-05', dids: 430, credentials: 880 },
  { date: '2024-06', dids: 560, credentials: 1120 },
];

const DEFAULT_ISSUERS: IssuerVolume[] = [
  { issuer: 'Acme Corp', volume: 420 },
  { issuer: 'Globex', volume: 310 },
  { issuer: 'Initech', volume: 260 },
  { issuer: 'Umbrella', volume: 190 },
  { issuer: 'Soylent', volume: 120 },
];

const DEFAULT_GEO: GeoDistribution[] = [
  { region: 'North America', count: 520 },
  { region: 'Europe', count: 410 },
  { region: 'Asia', count: 330 },
  { region: 'South America', count: 140 },
  { region: 'Africa', count: 90 },
  { region: 'Oceania', count: 60 },
];

const DEFAULT_VERIFICATION: VerificationPoint[] = [
  { date: '2024-01', successRate: 92, total: 240 },
  { date: '2024-02', successRate: 94, total: 360 },
  { date: '2024-03', successRate: 93, total: 520 },
  { date: '2024-04', successRate: 96, total: 690 },
  { date: '2024-05', successRate: 97, total: 880 },
  { date: '2024-06', successRate: 98, total: 1120 },
];

const DEFAULT_CREDENTIAL_TYPES: CredentialTypeSlice[] = [
  { type: 'Identity', count: 480 },
  { type: 'Education', count: 320 },
  { type: 'Employment', count: 260 },
  { type: 'Health', count: 150 },
  { type: 'Financial', count: 110 },
];

/**
 * Serialize a DOM node to a PNG data URL using a canvas-based approach.
 * This is a lightweight html-to-image fallback that walks the DOM and
 * draws text/backgrounds. For richer fidelity, an html-to-image library
 * can be swapped in without changing the public API.
 */
async function nodeToPngDataUrl(node: HTMLElement): Promise<string> {
  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire 2D canvas context');
  }

  ctx.scale(scale, scale);

  // Fill background.
  const bg = getComputedStyle(node).backgroundColor;
  ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Draw SVG charts (recharts renders SVG) by serializing them.
  const svgs = Array.from(node.querySelectorAll('svg'));
  for (const svg of svgs) {
    try {
      const svgRect = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const serialized = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      ctx.drawImage(
        img,
        svgRect.left - rect.left,
        svgRect.top - rect.top,
        svgRect.width,
        svgRect.height,
      );
      URL.revokeObjectURL(url);
    } catch {
      // Skip individual SVG failures; continue rendering the rest.
    }
  }

  // Draw text nodes (titles, labels) that are not part of SVGs.
  const textNodes = Array.from(node.querySelectorAll('h1,h2,h3,h4,p,span,label,button'));
  for (const el of textNodes) {
    if (el.closest('svg')) continue;
    const elRect = el.getBoundingClientRect();
    if (elRect.width === 0 || elRect.height === 0) continue;
    const style = getComputedStyle(el);
    const text = (el.textContent || '').trim();
    if (!text) continue;
    ctx.fillStyle = style.color || '#111827';
    const fontSize = parseFloat(style.fontSize) || 14;
    ctx.font = `${style.fontWeight || 'normal'} ${fontSize}px ${style.fontFamily || 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      text,
      elRect.left - rect.left,
      elRect.top - rect.top + elRect.height / 2,
      elRect.width,
    );
  }

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = /:(.*?);/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

const NetworkStatistics: React.FC<NetworkStatisticsProps> = ({
  timeSeriesData,
  issuerData,
  geoData,
  verificationData,
  credentialTypeData,
  loading = false,
  error = null,
  onRefresh,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedIssuer, setSelectedIssuer] = useState<string>('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const rawTimeSeries = timeSeriesData ?? DEFAULT_TIME_SERIES;
  const rawIssuers = issuerData ?? DEFAULT_ISSUERS;
  const rawGeo = geoData ?? DEFAULT_GEO;
  const rawVerification = verificationData ?? DEFAULT_VERIFICATION;
  const rawCredentialTypes = credentialTypeData ?? DEFAULT_CREDENTIAL_TYPES;

  const credentialTypeOptions = useMemo(
    () => Array.from(new Set(rawCredentialTypes.map((c) => c.type))),
    [rawCredentialTypes],
  );

  const issuerOptions = useMemo(
    () => Array.from(new Set(rawIssuers.map((i) => i.issuer))),
    [rawIssuers],
  );

  const filteredTimeSeries = useMemo(() => {
    return rawTimeSeries.filter((point) => {
      if (startDate && point.date < startDate) return false;
      if (endDate && point.date > endDate) return false;
      return true;
    });
  }, [rawTimeSeries, startDate, endDate]);

  const filteredVerification = useMemo(() => {
    return rawVerification.filter((point) => {
      if (startDate && point.date < startDate) return false;
      if (endDate && point.date > endDate) return false;
      return true;
    });
  }, [rawVerification, startDate, endDate]);

  const filteredIssuers = useMemo(() => {
    const list =
      selectedIssuer === 'all'
        ? rawIssuers
        : rawIssuers.filter((i) => i.issuer === selectedIssuer);
    return [...list].sort((a, b) => b.volume - a.volume);
  }, [rawIssuers, selectedIssuer]);

  const filteredCredentialTypes = useMemo(() => {
    const list =
      selectedType === 'all'
        ? rawCredentialTypes
        : rawCredentialTypes.filter((c) => c.type === selectedType);
    return [...list].sort((a, b) => b.count - a.count);
  }, [rawCredentialTypes, selectedType]);

  const filteredGeo = useMemo(() => {
    return [...rawGeo].sort((a, b) => b.count - a.count);
  }, [rawGeo]);

  const totalDids = useMemo(
    () => filteredTimeSeries.reduce((sum, p) => sum + p.dids, 0),
    [filteredTimeSeries],
  );

  const totalCredentials = useMemo(
    () => filteredTimeSeries.reduce((sum, p) => sum + p.credentials, 0),
    [filteredTimeSeries],
  );

  const averageSuccessRate = useMemo(() => {
    if (filteredVerification.length === 0) return 0;
    const sum = filteredVerification.reduce((acc, p) => acc + p.successRate, 0);
    return Math.round((sum / filteredVerification.length) * 10) / 10;
  }, [filteredVerification]);

  const handleExport = useCallback(async () => {
    if (!chartContainerRef.current) return;
    setExporting(true);
    setExportError(null);
    try {
      const dataUrl = await nodeToPngDataUrl(chartContainerRef.current);
      const blob = dataUrlToBlob(dataUrl);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadFile({
        data: blob,
        filename: `network-statistics-${timestamp}.png`,
        mimeType: 'image/png',
      });
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Failed to export chart image',
      );
    } finally {
      setExporting(false);
    }
  }, []);

  const handleResetFilters = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setSelectedType('all');
    setSelectedIssuer('all');
  }, []);

  const renderTooltip = (formatter?: (value: number | string) => string) => (
    <Tooltip
      contentStyle={{
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        border: 'none',
        borderRadius: 8,
        color: '#f9fafb',
        fontSize: 12,
      }}
      labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
      formatter={((value: any) =>
        formatter ? formatter(value) : String(value)
      ) as any}
    />
  );

  return (
    <div className="network-statistics" data-testid="network-statistics">
      <header className="network-statistics__header">
        <div>
          <h1>Network Statistics</h1>
          <p className="network-statistics__subtitle">
            Network-wide DID and credential analytics
          </p>
        </div>
        <div className="network-statistics__actions">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="network-statistics__button"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="network-statistics__button network-statistics__button--primary"
            data-testid="export-image-button"
          >
            {exporting ? 'Exporting…' : 'Export as Image'}
          </button>
        </div>
      </header>

      {error && (
        <div className="network-statistics__error" role="alert">
          {error}
        </div>
      )}
      {exportError && (
        <div className="network-statistics__error" role="alert">
          {exportError}
        </div>
      )}

      <section className="network-statistics__filters" aria-label="Filters">
        <div className="network-statistics__filter">
          <label htmlFor="ns-start-date">Start date</label>
          <input
            id="ns-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="network-statistics__filter">
          <label htmlFor="ns-end-date">End date</label>
          <input
            id="ns-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="network-statistics__filter">
          <label htmlFor="ns-credential-type">Credential type</label>
          <select
            id="ns-credential-type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="all">All types</option>
            {credentialTypeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="network-statistics__filter">
          <label htmlFor="ns-issuer">Issuer</label>
          <select
            id="ns-issuer"
            value={selectedIssuer}
            onChange={(e) => setSelectedIssuer(e.target.value)}
          >
            <option value="all">All issuers</option>
            {issuerOptions.map((issuer) => (
              <option key={issuer} value={issuer}>
                {issuer}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleResetFilters}
          className="network-statistics__button"
        >
          Reset
        </button>
      </section>

      <section className="network-statistics__summary" aria-label="Summary">
        <div className="network-statistics__stat">
          <span className="network-statistics__stat-label">Total DIDs</span>
          <span className="network-statistics__stat-value">
            {totalDids.toLocaleString()}
          </span>
        </div>
        <div className="network-statistics__stat">
          <span className="network-statistics__stat-label">Total Credentials</span>
          <span className="network-statistics__stat-value">
            {totalCredentials.toLocaleString()}
          </span>
        </div>
        <div className="network-statistics__stat">
          <span className="network-statistics__stat-label">
            Avg. Verification Success
          </span>
          <span className="network-statistics__stat-value">
            {averageSuccessRate}%
          </span>
        </div>
      </section>

      {loading ? (
        <div className="network-statistics__loading" role="status">
          Loading network statistics…
        </div>
      ) : (
        <div
          className="network-statistics__charts"
          ref={chartContainerRef}
          data-testid="charts-container"
        >
          <div className="network-statistics__chart-card">
            <h2>Total DIDs &amp; Credentials Over Time</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={filteredTimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                {renderTooltip()}
                <Legend />
                <Line
                  type="monotone"
                  dataKey="dids"
                  name="DIDs"
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="credentials"
                  name="Credentials"
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="network-statistics__chart-card">
            <h2>Top Issuers by Volume</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={filteredIssuers}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="issuer" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                {renderTooltip()}
                <Legend />
                <Bar dataKey="volume" name="Volume" fill={CHART_COLORS[2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="network-statistics__chart-card">
            <h2>Geographic Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                {renderTooltip()}
                <Legend />
                <Pie
                  data={filteredGeo}
                  dataKey="count"
                  nameKey="region"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {filteredGeo.map((entry, index) => (
                    <Cell
                      key={`geo-${entry.region}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="network-statistics__chart-card">
            <h2>Verification Success Rate</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={filteredVerification}>
                <defs>
                  <linearGradient id="successRateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                {renderTooltip((value) => `${value}%`)}
                <Legend />
                <Area
                  type="monotone"
                  dataKey="successRate"
                  name="Success Rate"
                  stroke={CHART_COLORS[3]}
                  fill="url(#successRateFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="network-statistics__chart-card">
            <h2>Credential Type Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                {renderTooltip()}
                <Legend />
                <Pie
                  data={filteredCredentialTypes}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {filteredCredentialTypes.map((entry, index) => (
                    <Cell
                      key={`type-${entry.type}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkStatistics;