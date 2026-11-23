import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule(), new xBullModule()],
});

/** Session-storage key used to persist connection state across HMR reloads. */
const SESSION_KEY = 'soroban_identity_wallet';

/** localStorage key used to persist the dashboard layout preferences. */
const DASHBOARD_LAYOUT_KEY = 'soroban_identity_dashboard_layout';

interface PersistedState {
  address: string;
}

/**
 * Read the previously persisted address from sessionStorage.
 * Returns `null` when nothing is stored or the stored value is invalid.
 * sessionStorage is tab-scoped, so this has no effect in other tabs or after
 * the browser window is closed — identical to production behaviour.
 */
function loadPersistedAddress(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return typeof parsed.address === 'string' && parsed.address.length > 0
      ? parsed.address
      : null;
  } catch {
    return null;
  }
}

function persistAddress(address: string | null): void {
  try {
    if (address) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ address }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in certain environments (e.g. SSR).
  }
}

// ---------------------------------------------------------------------------
// Dashboard layout customization (drag-and-drop dashboard)
// ---------------------------------------------------------------------------

/** A single grid item in the dashboard layout (react-grid-layout compatible). */
export interface DashboardLayoutItem {
  /** Unique widget instance id. */
  i: string;
  /** Widget type key, used to look up the widget definition. */
  widgetType: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Per-widget configuration values. */
  config?: Record<string, unknown>;
}

/** A named dashboard preset (e.g. "default", "compact", "analytics"). */
export interface DashboardPreset {
  id: string;
  name: string;
  layout: DashboardLayoutItem[];
}

export interface DashboardLayoutState {
  /** Currently active preset id. */
  presetId: string;
  /** Current grid layout. */
  layout: DashboardLayoutItem[];
  /** Available presets, including the built-in default. */
  presets: DashboardPreset[];
}

/** Built-in default layout used for the reset-to-default action. */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutItem[] = [
  { i: 'balances', widgetType: 'balances', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
  { i: 'activity', widgetType: 'activity', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
  { i: 'credentials', widgetType: 'credentials', x: 0, y: 4, w: 4, h: 3, minW: 2, minH: 2 },
  { i: 'reputation', widgetType: 'reputation', x: 4, y: 4, w: 4, h: 3, minW: 2, minH: 2 },
  { i: 'quick-actions', widgetType: 'quick-actions', x: 8, y: 4, w: 4, h: 3, minW: 2, minH: 2 },
];

/** Built-in presets available out of the box. */
export const DEFAULT_DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: 'default',
    name: 'Default',
    layout: DEFAULT_DASHBOARD_LAYOUT,
  },
  {
    id: 'compact',
    name: 'Compact',
    layout: [
      { i: 'balances', widgetType: 'balances', x: 0, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
      { i: 'activity', widgetType: 'activity', x: 4, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
      { i: 'credentials', widgetType: 'credentials', x: 8, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
      { i: 'reputation', widgetType: 'reputation', x: 0, y: 3, w: 6, h: 2, minW: 2, minH: 2 },
      { i: 'quick-actions', widgetType: 'quick-actions', x: 6, y: 3, w: 6, h: 2, minW: 2, minH: 2 },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    layout: [
      { i: 'activity', widgetType: 'activity', x: 0, y: 0, w: 8, h: 5, minW: 3, minH: 2 },
      { i: 'reputation', widgetType: 'reputation', x: 8, y: 0, w: 4, h: 5, minW: 2, minH: 2 },
      { i: 'balances', widgetType: 'balances', x: 0, y: 5, w: 6, h: 3, minW: 3, minH: 2 },
      { i: 'credentials', widgetType: 'credentials', x: 6, y: 5, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'quick-actions', widgetType: 'quick-actions', x: 0, y: 8, w: 12, h: 2, minW: 2, minH: 2 },
    ],
  },
];

function cloneLayout(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
  return layout.map((item) => ({ ...item, config: item.config ? { ...item.config } : undefined }));
}

function defaultLayoutState(): DashboardLayoutState {
  return {
    presetId: 'default',
    layout: cloneLayout(DEFAULT_DASHBOARD_LAYOUT),
    presets: DEFAULT_DASHBOARD_PRESETS.map((p) => ({ ...p, layout: cloneLayout(p.layout) })),
  };
}

/**
 * Read the persisted dashboard layout from localStorage.
 * Falls back to the default layout when nothing is stored or the stored value
 * is invalid.
 */
function loadPersistedDashboardLayout(): DashboardLayoutState {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return defaultLayoutState();
    const parsed = JSON.parse(raw) as Partial<DashboardLayoutState>;
    if (!Array.isArray(parsed.layout)) return defaultLayoutState();
    const presets =
      Array.isArray(parsed.presets) && parsed.presets.length > 0
        ? parsed.presets
        : defaultLayoutState().presets;
    return {
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : 'default',
      layout: parsed.layout,
      presets,
    };
  } catch {
    return defaultLayoutState();
  }
}

function persistDashboardLayout(state: DashboardLayoutState): void {
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in certain environments (e.g. SSR).
  }
}

// Rehydrate from sessionStorage on module creation so that HMR and page
// refreshes with an active Freighter connection restore isConnected: true.
let _address: string | null = loadPersistedAddress();
const _listeners = new Set<(address: string | null) => void>();

function set(partial: { address: string | null }) {
  _address = partial.address;
  persistAddress(_address);
  _listeners.forEach((fn) => fn(_address));
}

// Rehydrate the dashboard layout from localStorage on module creation.
let _dashboardLayout: DashboardLayoutState = loadPersistedDashboardLayout();
const _dashboardListeners = new Set<(state: DashboardLayoutState) => void>();

function setDashboardLayout(next: DashboardLayoutState) {
  _dashboardLayout = next;
  persistDashboardLayout(_dashboardLayout);
  _dashboardListeners.forEach((fn) => fn(_dashboardLayout));
}

export const walletStore = {
  getAddress: (): string | null => _address,

  subscribe: (fn: (address: string | null) => void): (() => void) => {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  connect: async (): Promise<void> => {
    try {
      // Firefox compatibility fix: add explicit timeout and retry logic
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Wallet connection timeout')), 15000)
      );

      const connectionPromise = kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const address = await kit.getPublicKey();
          set({ address });
        },
      });

      await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      // Firefox may not trigger the modal properly, attempt direct connection
      if (typeof window.freighter !== 'undefined') {
        try {
          if (await window.freighter.isConnected()) {
            const publicKey = await window.freighter.getPublicKey();
            set({ address: publicKey });
            return;
          }
        } catch (directError) {
          console.error('Direct Freighter connection failed:', directError);
        }
      }
      throw error;
    }
  },

  /** Disconnects the wallet and clears the persisted sessionStorage state. */
  disconnect: (): void => {
    set({ address: null });
    kit.setWallet(FREIGHTER_ID);
  },

  sign: async (xdr: string): Promise<string> => {
    const { signedXDR } = await kit.sign({
      xdr,
    } as any);
    return signedXDR;
  },

  getKit: (): StellarWalletsKit => kit,

  // -------------------------------------------------------------------------
  // Dashboard layout customization
  // -------------------------------------------------------------------------

  /** Returns the current dashboard layout state. */
  getDashboardLayout: (): DashboardLayoutState => _dashboardLayout,

  /** Subscribe to dashboard layout changes. Returns an unsubscribe function. */
  subscribeDashboardLayout: (fn: (state: DashboardLayoutState) => void): (() => void) => {
    _dashboardListeners.add(fn);
    return () => _dashboardListeners.delete(fn);
  },

  /** Replaces the current grid layout (e.g. after drag/resize) and persists it. */
  updateDashboardLayout: (layout: DashboardLayoutItem[]): void => {
    setDashboardLayout({ ..._dashboardLayout, layout: cloneLayout(layout) });
  },

  /** Updates the configuration of a single widget instance. */
  updateWidgetConfig: (widgetId: string, config: Record<string, unknown>): void => {
    const layout = _dashboardLayout.layout.map((item) =>
      item.i === widgetId ? { ...item, config: { ...item.config, ...config } } : item
    );
    setDashboardLayout({ ..._dashboardLayout, layout });
  },

  /** Adds a widget instance to the current layout. */
  addWidget: (item: DashboardLayoutItem): void => {
    if (_dashboardLayout.layout.some((existing) => existing.i === item.i)) return;
    setDashboardLayout({
      ..._dashboardLayout,
      layout: [..._dashboardLayout.layout, { ...item }],
    });
  },

  /** Removes a widget instance from the current layout. */
  removeWidget: (widgetId: string): void => {
    setDashboardLayout({
      ..._dashboardLayout,
      layout: _dashboardLayout.layout.filter((item) => item.i !== widgetId),
    });
  },

  /** Applies a preset by id. No-op when the preset does not exist. */
  applyDashboardPreset: (presetId: string): void => {
    const preset = _dashboardLayout.presets.find((p) => p.id === presetId);
    if (!preset) return;
    setDashboardLayout({
      ..._dashboardLayout,
      presetId,
      layout: cloneLayout(preset.layout),
    });
  },

  /** Saves the current layout as a named preset. */
  saveDashboardPreset: (id: string, name: string): void => {
    const preset: DashboardPreset = {
      id,
      name,
      layout: cloneLayout(_dashboardLayout.layout),
    };
    const presets = _dashboardLayout.presets.filter((p) => p.id !== id);
    setDashboardLayout({
      ..._dashboardLayout,
      presetId: id,
      presets: [...presets, preset],
    });
  },

  /** Resets the dashboard layout to the built-in default and persists it. */
  resetDashboardLayout: (): void => {
    setDashboardLayout(defaultLayoutState());
  },
};
