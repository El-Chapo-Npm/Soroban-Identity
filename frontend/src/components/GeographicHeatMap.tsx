import React, { useMemo, useState } from 'react';

export interface GeographicHeatMapDatum {
  country: string;
  count: number;
}

export interface GeographicHeatMapProps {
  data: GeographicHeatMapDatum[];
  title?: string;
  className?: string;
}

interface RegionCell {
  code: string;
  label: string;
  row: number;
  col: number;
}

// Lightweight choropleth-style region grid. Each cell represents a country/region.
const REGIONS: RegionCell[] = [
  { code: 'CA', label: 'Canada', row: 0, col: 1 },
  { code: 'US', label: 'United States', row: 1, col: 1 },
  { code: 'MX', label: 'Mexico', row: 2, col: 1 },
  { code: 'BR', label: 'Brazil', row: 3, col: 2 },
  { code: 'AR', label: 'Argentina', row: 4, col: 2 },
  { code: 'GB', label: 'United Kingdom', row: 1, col: 4 },
  { code: 'FR', label: 'France', row: 1, col: 5 },
  { code: 'DE', label: 'Germany', row: 1, col: 6 },
  { code: 'ES', label: 'Spain', row: 2, col: 4 },
  { code: 'IT', label: 'Italy', row: 2, col: 5 },
  { code: 'NL', label: 'Netherlands', row: 1, col: 7 },
  { code: 'SE', label: 'Sweden', row: 0, col: 6 },
  { code: 'NO', label: 'Norway', row: 0, col: 5 },
  { code: 'PL', label: 'Poland', row: 1, col: 8 },
  { code: 'RU', label: 'Russia', row: 0, col: 9 },
  { code: 'TR', label: 'Turkey', row: 2, col: 7 },
  { code: 'EG', label: 'Egypt', row: 3, col: 6 },
  { code: 'ZA', label: 'South Africa', row: 4, col: 6 },
  { code: 'NG', label: 'Nigeria', row: 3, col: 5 },
  { code: 'KE', label: 'Kenya', row: 4, col: 7 },
  { code: 'SA', label: 'Saudi Arabia', row: 3, col: 7 },
  { code: 'AE', label: 'United Arab Emirates', row: 3, col: 8 },
  { code: 'IN', label: 'India', row: 3, col: 9 },
  { code: 'CN', label: 'China', row: 2, col: 10 },
  { code: 'JP', label: 'Japan', row: 2, col: 11 },
  { code: 'KR', label: 'South Korea', row: 2, col: 12 },
  { code: 'SG', label: 'Singapore', row: 4, col: 10 },
  { code: 'ID', label: 'Indonesia', row: 4, col: 11 },
  { code: 'AU', label: 'Australia', row: 5, col: 11 },
  { code: 'NZ', label: 'New Zealand', row: 6, col: 12 },
];

const GRID_ROWS = 7;
const GRID_COLS = 13;
const CELL_SIZE = 34;
const CELL_GAP = 4;
const PADDING = 8;

const MIN_COLOR = { r: 219, g: 234, b: 254 }; // light blue
const MAX_COLOR = { r: 30, g: 64, b: 175 }; // deep blue

function interpolateColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const r = Math.round(MIN_COLOR.r + (MAX_COLOR.r - MIN_COLOR.r) * t);
  const g = Math.round(MIN_COLOR.g + (MAX_COLOR.g - MIN_COLOR.g) * t);
  const b = Math.round(MIN_COLOR.b + (MAX_COLOR.b - MIN_COLOR.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function textColorFor(intensity: number): string {
  return intensity > 0.55 ? '#ffffff' : '#1e3a8a';
}

export const GeographicHeatMap: React.FC<GeographicHeatMapProps> = ({
  data,
  title = 'Geographic Credential Usage',
  className,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const { countByCountry, maxCount } = useMemo(() => {
    const map = new Map<string, number>();
    let max = 0;
    for (const item of data) {
      if (!item || typeof item.country !== 'string') continue;
      const key = item.country.trim().toUpperCase();
      const value = Number.isFinite(item.count) ? Math.max(0, item.count) : 0;
      map.set(key, (map.get(key) ?? 0) + value);
      if (value > max) max = value;
    }
    return { countByCountry: map, maxCount: max };
  }, [data]);

  const width = PADDING * 2 + GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * CELL_GAP;
  const height = PADDING * 2 + GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * CELL_GAP;

  const legendSteps = 5;
  const legendWidth = 160;
  const legendHeight = 12;

  const hoveredRegion = hovered
    ? REGIONS.find((region) => region.code === hovered)
    : undefined;
  const hoveredCount = hovered ? countByCountry.get(hovered) ?? 0 : 0;

  return (
    <div className={className} style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {hoveredRegion
            ? `${hoveredRegion.label}: ${hoveredCount.toLocaleString()}`
            : 'Hover a region for details'}
        </span>
      </div>

      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: 'block', maxWidth: width }}
      >
        {REGIONS.map((region) => {
          const count = countByCountry.get(region.code) ?? 0;
          const intensity = maxCount > 0 ? count / maxCount : 0;
          const x = PADDING + region.col * (CELL_SIZE + CELL_GAP);
          const y = PADDING + region.row * (CELL_SIZE + CELL_GAP);
          const isHovered = hovered === region.code;

          return (
            <g
              key={region.code}
              onMouseEnter={() => setHovered(region.code)}
              onMouseLeave={() => setHovered((prev) => (prev === region.code ? null : prev))}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x}
                y={y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={4}
                ry={4}
                fill={interpolateColor(intensity)}
                stroke={isHovered ? '#111827' : '#ffffff'}
                strokeWidth={isHovered ? 2 : 1}
              />
              <text
                x={x + CELL_SIZE / 2}
                y={y + CELL_SIZE / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={textColorFor(intensity)}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {region.code}
              </text>
              <title>
                {region.label}: {count.toLocaleString()}
              </title>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          fontSize: 12,
          color: '#4b5563',
        }}
      >
        <span>0</span>
        <svg
          width={legendWidth}
          height={legendHeight}
          role="img"
          aria-label="Color intensity legend"
        >
          {Array.from({ length: legendSteps }).map((_, index) => {
            const stepWidth = legendWidth / legendSteps;
            const intensity = index / (legendSteps - 1);
            return (
              <rect
                key={index}
                x={index * stepWidth}
                y={0}
                width={stepWidth}
                height={legendHeight}
                fill={interpolateColor(intensity)}
              />
            );
          })}
        </svg>
        <span>{maxCount.toLocaleString()}</span>
      </div>
    </div>
  );
};

export default GeographicHeatMap;