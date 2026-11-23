import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import GridLayout, { Layout, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// ---------------------------------------------------------------------------
// Offline storage utilities (with graceful fallback if module is unavailable)
// ---------------------------------------------------------------------------
interface OfflineStorageLike {
  setItem?: (key: string, value: string) => Promise<void> | void;
  getItem?: (key: string) => Promise<string | null> | string | null;
  removeItem?: (key: string) => Promise<void> | void;
}

let offlineStorage: OfflineStorageLike | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  offlineStorage = require('../utils/offlineStorage');
} catch {
  offlineStorage = null;
}

// ---------------------------------------------------------------------------
// Reused components (with safe fallbacks so the page never crashes)
// ---------------------------------------------------------------------------
interface VerificationBadgeProps {
  verified?: boolean;
  label?: string;
}

const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  verified = true,
  label,
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      verified
        ? 'bg-green-100 text-green-800'
        : 'bg-gray-100 text-gray-700'
    }`}
  >
    <span aria-hidden="true">{verified ? '✓' : '○'}</span>
    {label ?? (verified ? 'Verified' : 'Unverified')}
  </span>
);

interface QRScannerProps {
  onScan?: (value: string) => void;
  compact?: boolean;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, compact }) => {
  const [value, setValue] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 ${
          compact ? 'h-16' : 'h-32'
        }`}
      >
        <span className="text-xs">QR Scanner</span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Scan result…"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            if (value && onScan) onScan(value);
          }}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          Submit
        </button>
      </div>
    </div>
  );
};

interface MiniChartProps {
  title?: string;
  data?: number[];
  color?: string;
}

const MiniChart: React.FC<MiniChartProps> = ({
  title = 'Chart',
  data = [4, 8, 6, 10, 7, 12, 9],
  color = '#2563eb',
}) => {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-full flex-col">
      {title && (
        <div className="mb-1 text-xs font-medium text-gray-600">{title}</div>
      )}
      <div className="flex flex-1 items-end gap-1">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.max((v / max) * 100, 4)}%`,
              backgroundColor: color,
            }}
          />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Breakpoint = 'lg' | 'md' | 'sm' | 'xs' | 'xxs';

interface WidgetConfig {
  title?: string;
  color?: string;
  verified?: boolean;
  compact?: boolean;
  [key: string]: unknown;
}

interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  render: (config: WidgetConfig) => React.ReactNode;
  configurable?: boolean;
}

interface PlacedWidget {
  instanceId: string;
  widgetId: string;
  config: WidgetConfig;
}

type Layouts = Record<string, Layout[]>;

interface PersistedState {
  widgets: PlacedWidget[];
  layouts: Layouts;
  version: number;
}

interface PresetDefinition {
  id: string;
  name: string;
  description: string;
  build: () => { widgets: PlacedWidget[]; layouts: Layouts };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'customizable-dashboard-layout-v1';
const BACKEND_SYNC_KEY = 'customizable-dashboard-layout';
const STATE_VERSION = 1;

const BREAKPOINTS: Record<Breakpoint, number> = {
  lg: 1200,
  md: 996,
  sm: 768,
  xs: 480,
  xxs: 0,
};

const COLS: Record<Breakpoint, number> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2,
};

const ROW_HEIGHT = 60;
const MARGIN: [number, number] = [12, 12];

const ResponsiveGridLayout = WidthProvider(GridLayout);

// ---------------------------------------------------------------------------
// Widget registry / library
// ---------------------------------------------------------------------------
const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'verification-badge',
    name: 'Verification Badge',
    description: 'Shows the verification status of a record.',
    icon: '✓',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    configurable: true,
    render: (config) => (
      <div className="flex h-full items-center justify-center">
        <VerificationBadge
          verified={config.verified !== false}
          label={config.title}
        />
      </div>
    ),
  },
  {
    id: 'qr-scanner',
    name: 'QR Scanner',
    description: 'Scan or enter QR codes quickly.',
    icon: '▣',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    configurable: true,
    render: (config) => (
      <QRScanner compact={config.compact === true} />
    ),
  },
  {
    id: 'activity-chart',
    name: 'Activity Chart',
    description: 'Bar chart of recent activity.',
    icon: '▤',
    defaultSize: { w: 5, h: 4 },
    minSize: { w: 3, h: 3 },
    configurable: true,
    render: (config) => (
      <MiniChart
        title={config.title ?? 'Activity'}
        color={config.color ?? '#2563eb'}
      />
    ),
  },
  {
    id: 'stats-chart',
    name: 'Stats Chart',
    description: 'Compact statistics overview.',
    icon: '▥',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    configurable: true,
    render: (config) => (
      <MiniChart
        title={config.title ?? 'Stats'}
        color={config.color ?? '#16a34a'}
        data={[3, 5, 4, 7, 6, 8, 5]}
      />
    ),
  },
  {
    id: 'quick-actions',
    name: 'Quick Actions',
    description: 'Shortcut buttons for common tasks.',
    icon: '⚡',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    configurable: true,
    render: (config) => (
      <div className="flex h-full flex-col gap-2">
        <div className="text-xs font-medium text-gray-600">
          {config.title ?? 'Quick Actions'}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {['New', 'Scan', 'Verify', 'Export'].map((a) => (
            <button
              key={a}
              type="button"
              className="rounded border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
            >
              {a}
            </button>
          ))}
        </div>
      </div>
    ),
  },
];

const WIDGET_MAP: Record<string, WidgetDefinition> = WIDGET_REGISTRY.reduce(
  (acc, w) => {
    acc[w.id] = w;
    return acc;
  },
  {} as Record<string, WidgetDefinition>,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let instanceCounter = 0;
const createInstanceId = (widgetId: string): string => {
  instanceCounter += 1;
  return `${widgetId}-${Date.now().toString(36)}-${instanceCounter}`;
};

const cloneLayouts = (layouts: Layouts): Layouts => {
  const out: Layouts = {};
  Object.keys(layouts).forEach((bp) => {
    out[bp] = layouts[bp].map((l) => ({ ...l }));
  });
  return out;
};

const buildLayoutsForWidgets = (
  widgets: PlacedWidget[],
  base?: Layouts,
): Layouts => {
  const breakpoints = Object.keys(COLS) as Breakpoint[];
  const layouts: Layouts = {};

  breakpoints.forEach((bp) => {
    const cols = COLS[bp];
    const existing = base?.[bp] ?? [];
    const existingMap = new Map(existing.map((l) => [l.i, l]));

    let cursorX = 0;
    let cursorY = 0;

    layouts[bp] = widgets.map((w) => {
      const def = WIDGET_MAP[w.widgetId];
      const prev = existingMap.get(w.instanceId);
      if (prev) {
        return {
          ...prev,
          i: w.instanceId,
          minW: def?.minSize?.w ?? 1,
          minH: def?.minSize?.h ?? 1,
        };
      }
      const wSize = Math.min(def?.defaultSize.w ?? 3, cols);
      const hSize = def?.defaultSize.h ?? 2;
      if (cursorX + wSize > cols) {
        cursorX = 0;
        cursorY += hSize;
      }
      const layout: Layout = {
        i: w.instanceId,
        x: cursorX,
        y: cursorY,
        w: wSize,
        h: hSize,
        minW: def?.minSize?.w ?? 1,
        minH: def?.minSize?.h ?? 1,
      };
      cursorX += wSize;
      return layout;
    });
  });

  return layouts;
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const buildPreset = (
  entries: Array<{ widgetId: string; config?: WidgetConfig }>,
): { widgets: PlacedWidget[]; layouts: Layouts } => {
  const widgets: PlacedWidget[] = entries.map((e) => ({
    instanceId: createInstanceId(e.widgetId),
    widgetId: e.widgetId,
    config: e.config ?? {},
  }));
  return { widgets, layouts: buildLayoutsForWidgets(widgets) };
};

const PRESETS: PresetDefinition[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Balanced layout with verification and activity.',
    build: () =>
      buildPreset([
        { widgetId: 'verification-badge' },
        { widgetId: 'activity-chart' },
        { widgetId: 'qr-scanner' },
        { widgetId: 'quick-actions' },
      ]),
  },
  {
    id: 'scanner-focus',
    name: 'Scanner Focus',
    description: 'Large scanner with quick actions.',
    build: () =>
      buildPreset([
        { widgetId: 'qr-scanner', config: { compact: false } },
        { widgetId: 'quick-actions' },
        { widgetId: 'verification-badge' },
      ]),
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Charts and stats front and center.',
    build: () =>
      buildPreset([
        { widgetId: 'activity-chart', config: { title: 'Activity' } },
        { widgetId: 'stats-chart', config: { title: 'Stats' } },
        { widgetId: 'verification-badge' },
      ]),
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials.',
    build: () =>
      buildPreset([
        { widgetId: 'verification-badge' },
        { widgetId: 'quick-actions' },
      ]),
  },
];

const DEFAULT_PRESET = PRESETS[0];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const loadPersistedState = (): PersistedState | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || !Array.isArray(parsed.widgets) || !parsed.layouts) {
      return null;
    }
    // Filter out widgets whose definitions no longer exist.
    const widgets = parsed.widgets.filter((w) => WIDGET_MAP[w.widgetId]);
    return {
      widgets,
      layouts: parsed.layouts,
      version: parsed.version ?? STATE_VERSION,
    };
  } catch {
    return null;
  }
};

const persistState = async (state: PersistedState): Promise<void> => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy errors
  }
  if (offlineStorage && typeof offlineStorage.setItem === 'function') {
    try {
      await offlineStorage.setItem(BACKEND_SYNC_KEY, JSON.stringify(state));
    } catch {
      // ignore backend sync failures
    }
  }
};

// ---------------------------------------------------------------------------
// Configuration dialog
// ---------------------------------------------------------------------------
interface ConfigDialogProps {
  widget: PlacedWidget;
  definition: WidgetDefinition;
  onSave: (config: WidgetConfig) => void;
  onClose: () => void;
}

const ConfigDialog: React.FC<ConfigDialogProps> = ({
  widget,
  definition,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState<string>(
    (widget.config.title as string) ?? '',
  );
  const [color, setColor] = useState<string>(
    (widget.config.color as string) ?? '#2563eb',
  );
  const [verified, setVerified] = useState<boolean>(
    widget.config.verified !== false,
  );
  const [compact, setCompact] = useState<boolean>(
    widget.config.compact === true,
  );

  const supportsTitle =
    definition.id === 'activity-chart' ||
    definition.id === 'stats-chart' ||
    definition.id === 'quick-actions' ||
    definition.id === 'verification-badge';
  const supportsColor =
    definition.id === 'activity-chart' || definition.id === 'stats-chart';
  const supportsVerified = definition.id === 'verification-badge';
  const supportsCompact = definition.id === 'qr-scanner';

  const handleSave = () => {
    const next: WidgetConfig = { ...widget.config };
    if (supportsTitle) next.title = title;
    if (supportsColor) next.color = color;
    if (supportsVerified) next.verified = verified;
    if (supportsCompact) next.compact = compact;
    onSave(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Configure ${definition.name}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Configure {definition.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {supportsTitle && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={definition.name}
                className="rounded border border-gray-300 px-3 py-1.5"
              />
            </label>
          )}

          {supportsColor && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">Color</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-16 cursor-pointer rounded border border-gray-300"
              />
            </label>
          )}

          {supportsVerified && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              <span className="font-medium text-gray-700">
                Show as verified
              </span>
            </label>
          )}

          {supportsCompact && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />
              <span className="font-medium text-gray-700">Compact mode</span>
            </label>
          )}

          {!supportsTitle &&
            !supportsColor &&
            !supportsVerified &&
            !supportsCompact && (
              <p className="text-sm text-gray-500">
                This widget has no configurable options.
              </p>
            )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const CustomizableDashboard: React.FC = () => {
  const [widgets, setWidgets] = useState<PlacedWidget[]>([]);
  const [layouts, setLayouts] = useState<Layouts>({});
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>('lg');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [showLibrary, setShowLibrary] = useState<boolean>(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [initialized, setInitialized] = useState<boolean>(false);

  const persistTimer = useRef<number | null>(null);

  // Initial load -----------------------------------------------------------
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted && persisted.widgets.length > 0) {
      setWidgets(persisted.widgets);
      setLayouts(persisted.layouts);
    } else {
      const preset = DEFAULT_PRESET.build();
      setWidgets(preset.widgets);
      setLayouts(preset.layouts);
    }
    setInitialized(true);
  }, []);

  // Persist on change (debounced) -----------------------------------------
  useEffect(() => {
    if (!initialized) return;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      void persistState({
        widgets,
        layouts,
        version: STATE_VERSION,
      });
    }, 400);
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
      }
    };
  }, [widgets, layouts, initialized]);

  // Handlers ---------------------------------------------------------------
  const handleLayoutChange = useCallback(
    (current: Layout[], allLayouts: Layouts) => {
      setLayouts((prev) => {
        const next = cloneLayouts(prev);
        Object.keys(allLayouts).forEach((bp) => {
          next[bp] = allLayouts[bp].map((l) => ({ ...l }));
        });
        // Ensure current breakpoint reflects the live layout.
        next[currentBreakpoint] = current.map((l) => ({ ...l }));
        return next;
      });
    },
    [currentBreakpoint],
  );

  const handleBreakpointChange = useCallback((bp: string) => {
    setCurrentBreakpoint(bp as Breakpoint);
  }, []);

  const addWidget = useCallback((widgetId: string) => {
    const def = WIDGET_MAP[widgetId];
    if (!def) return;
    const instanceId = createInstanceId(widgetId);
    setWidgets((prev) => {
      const next = [
        ...prev,
        { instanceId, widgetId, config: {} as WidgetConfig },
      ];
      setLayouts((prevLayouts) => buildLayoutsForWidgets(next, prevLayouts));
      return next;
    });
  }, []);

  const removeWidget = useCallback((instanceId: string) => {
    setWidgets((prev) => {
      const next = prev.filter((w) => w.instanceId !== instanceId);
      setLayouts((prevLayouts) => {
        const cloned = cloneLayouts(prevLayouts);
        Object.keys(cloned).forEach((bp) => {
          cloned[bp] = cloned[bp].filter((l) => l.i !== instanceId);
        });
        return cloned;
      });
      return next;
    });
  }, []);

  const updateWidgetConfig = useCallback(
    (instanceId: string, config: WidgetConfig) => {
      setWidgets((prev) =>
        prev.map((w) =>
          w.instanceId === instanceId ? { ...w, config } : w,
        ),
      );
      setConfiguringId(null);
    },
    [],
  );

  const applyPreset = useCallback((preset: PresetDefinition) => {
    const built = preset.build();
    setWidgets(built.widgets);
    setLayouts(built.layouts);
    setShowPresets(false);
  }, []);

  const resetToDefault = useCallback(() => {
    const built = DEFAULT_PRESET.build();
    setWidgets(built.widgets);
    setLayouts(built.layouts);
    setShowResetConfirm(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (offlineStorage && typeof offlineStorage.removeItem === 'function') {
      try {
        void offlineStorage.removeItem(BACKEND_SYNC_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  const configuringWidget = useMemo(
    () => widgets.find((w) => w.instanceId === configuringId) ?? null,
    [widgets, configuringId],
  );

  const configuringDefinition = configuringWidget
    ? WIDGET_MAP[configuringWidget.widgetId]
    : null;

  // Render -----------------------------------------------------------------
  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header / toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
          <p className="text-sm text-gray-500">
            Customize your layout with drag-and-drop.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEditing((v) => !v)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              isEditing
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {isEditing ? 'Done Editing' : 'Edit Layout'}
          </button>

          <button
            type="button"
            onClick={() => setShowLibrary((v) => !v)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Widget Library
          </button>

          <button
            type="button"
            onClick={() => setShowPresets((v) => !v)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Presets
          </button>

          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Widget library panel */}
      {showLibrary && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Widget Library
            </h2>
            <button
              type="button"
              onClick={() => setShowLibrary(false)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close library"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WIDGET_REGISTRY.map((def) => (
              <div
                key={def.id}
                className="flex items-start gap-3 rounded border border-gray-200 p-3"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
                  {def.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {def.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {def.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addWidget(def.id)}
                  className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Presets panel */}
      {showPresets && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Dashboard Presets
            </h2>
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close presets"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50"
              >
                <div className="text-sm font-medium text-gray-900">
                  {preset.name}
                </div>
                <div className="text-xs text-gray-500">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="mb-3 text-gray-500">Your dashboard is empty.</p>
          <button
            type="button"
            onClick={() => setShowLibrary(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Widgets
          </button>
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          isDraggable={isEditing}
          isResizable={isEditing}
          draggableHandle=".widget-drag-handle"
          onLayoutChange={handleLayoutChange}
          onBreakpointChange={handleBreakpointChange}
          compactType="vertical"
          preventCollision={false}
        >
          {widgets.map((w) => {
            const def = WIDGET_MAP[w.widgetId];
            if (!def) return null;
            return (
              <div
                key={w.instanceId}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
                  <div
                    className={`flex items-center gap-2 text-xs font-medium text-gray-700 ${
                      isEditing ? 'widget-drag-handle cursor-move' : ''
                    }`}
                  >
                    <span aria-hidden="true">{def.icon}</span>
                    <span className="truncate">
                      {(w.config.title as string) || def.name}
                    </span>
                  </div>
                  {isEditing && (
                    <div className="flex items-center gap-1">
                      {def.configurable && (
                        <button
                          type="button"
                          onClick={() => setConfiguringId(w.instanceId)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100"
                          aria-label={`Configure ${def.name}`}
                          title="Configure"
                        >
                          ⚙
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeWidget(w.instanceId)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        aria-label={`Remove ${def.name}`}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div className="h-[calc(100%-2rem)] overflow-auto p-3">
                  {def.render(w.config)}
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      )}

      {/* Config dialog */}
      {configuringWidget && configuringDefinition && (
        <ConfigDialog
          widget={configuringWidget}
          definition={configuringDefinition}
          onSave={(config) =>
            updateWidgetConfig(configuringWidget.instanceId, config)
          }
          onClose={() => setConfiguringId(null)}
        />
      )}

      {/* Reset confirmation */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reset dashboard"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              Reset dashboard?
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              This will restore the default layout and remove your saved
              customizations.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetToDefault}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomizableDashboard;