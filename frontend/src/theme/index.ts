// frontend/src/theme/index.ts

/**
 * Custom theming engine.
 *
 * Provides a Theme type, a generator that converts a palette into CSS custom
 * properties matching the tokens in index.css, WCAG contrast validation,
 * JSON import/export, pre-built preset themes, persistence helpers, and an
 * applyTheme() function that writes CSS variables to the document root.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  /** Primary brand color. */
  primary: string;
  /** Secondary brand color. */
  secondary: string;
  /** Accent color used for highlights. */
  accent: string;
  /** Page background color. */
  background: string;
  /** Surface / card background color. */
  surface: string;
  /** Primary text color. */
  text: string;
  /** Muted / secondary text color. */
  textMuted: string;
  /** Border color. */
  border: string;
  /** Success state color. */
  success: string;
  /** Warning state color. */
  warning: string;
  /** Error / danger state color. */
  error: string;
  /** Info state color. */
  info: string;
}

export interface Theme {
  /** Unique identifier for the theme. */
  id: string;
  /** Human readable name. */
  name: string;
  /** Light or dark mode. */
  mode: ThemeMode;
  /** Color palette. */
  colors: ThemeColors;
  /** Optional logo as a data URL. */
  logo?: string;
  /** Additional custom CSS variables (name -> value). */
  customVariables?: Record<string, string>;
}

export interface ContrastResult {
  /** Foreground color evaluated. */
  foreground: string;
  /** Background color evaluated. */
  background: string;
  /** Contrast ratio (1 to 21). */
  ratio: number;
  /** Whether the pair passes WCAG AA for normal text (>= 4.5). */
  passesAA: boolean;
  /** Whether the pair passes WCAG AAA for normal text (>= 7). */
  passesAAA: boolean;
  /** Whether the pair passes WCAG AA for large text (>= 3). */
  passesAALarge: boolean;
}

export interface ContrastWarning {
  /** Description of the pair, e.g. "text on background". */
  pair: string;
  /** Foreground color. */
  foreground: string;
  /** Background color. */
  background: string;
  /** Contrast ratio. */
  ratio: number;
  /** Human readable message. */
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const STORAGE_KEY = 'custom-theme';

/** WCAG thresholds. */
const WCAG_AA_NORMAL = 4.5;
const WCAG_AAA_NORMAL = 7;
const WCAG_AA_LARGE = 3;

/* -------------------------------------------------------------------------- */
/* Color utilities                                                            */
/* -------------------------------------------------------------------------- */

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS color string (hex, rgb(), rgba()) into RGB components.
 * Returns null when the color cannot be parsed.
 */
export function parseColor(color: string): RGB | null {
  if (!color) return null;
  const value = color.trim().toLowerCase();

  // Hex formats: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return { r, g, b };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return { r, g, b };
    }
    return null;
  }

  // rgb() / rgba()
  const match = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/,
  );
  if (match) {
    const r = Math.round(parseFloat(match[1]));
    const g = Math.round(parseFloat(match[2]));
    const b = Math.round(parseFloat(match[3]));
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return {
      r: clampByte(r),
      g: clampByte(g),
      b: clampByte(b),
    };
  }

  return null;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute the WCAG relative luminance of a color.
 * Returns null if the color cannot be parsed.
 */
export function relativeLuminance(color: string): number | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the WCAG contrast ratio between two colors.
 * Returns null if either color cannot be parsed.
 */
export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Validate the contrast of a foreground/background pair against WCAG.
 */
export function validateContrast(
  foreground: string,
  background: string,
): ContrastResult | null {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) return null;
  return {
    foreground,
    background,
    ratio,
    passesAA: ratio >= WCAG_AA_NORMAL,
    passesAAA: ratio >= WCAG_AAA_NORMAL,
    passesAALarge: ratio >= WCAG_AA_LARGE,
  };
}

/**
 * Validate all important color pairs in a theme and return warnings for
 * pairs that fail WCAG AA for normal text.
 */
export function validateTheme(theme: Theme): ContrastWarning[] {
  const { colors } = theme;
  const pairs: Array<{ pair: string; fg: string; bg: string }> = [
    { pair: 'text on background', fg: colors.text, bg: colors.background },
    { pair: 'text on surface', fg: colors.text, bg: colors.surface },
    { pair: 'muted text on background', fg: colors.textMuted, bg: colors.background },
    { pair: 'muted text on surface', fg: colors.textMuted, bg: colors.surface },
    { pair: 'primary on background', fg: colors.primary, bg: colors.background },
    { pair: 'primary on surface', fg: colors.primary, bg: colors.surface },
    { pair: 'secondary on background', fg: colors.secondary, bg: colors.background },
    { pair: 'accent on background', fg: colors.accent, bg: colors.background },
    { pair: 'success on background', fg: colors.success, bg: colors.background },
    { pair: 'warning on background', fg: colors.warning, bg: colors.background },
    { pair: 'error on background', fg: colors.error, bg: colors.background },
    { pair: 'info on background', fg: colors.info, bg: colors.background },
  ];

  const warnings: ContrastWarning[] = [];
  for (const { pair, fg, bg } of pairs) {
    const result = validateContrast(fg, bg);
    if (!result) continue;
    if (!result.passesAA) {
      warnings.push({
        pair,
        foreground: fg,
        background: bg,
        ratio: result.ratio,
        message: `Contrast ratio ${result.ratio.toFixed(2)}:1 for "${pair}" fails WCAG AA (requires ${WCAG_AA_NORMAL}:1).`,
      });
    }
  }
  return warnings;
}

/* -------------------------------------------------------------------------- */
/* CSS variable generation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Convert a theme into a map of CSS custom properties matching the tokens
 * defined in index.css.
 */
export function generateCSSVariables(theme: Theme): Record<string, string> {
  const { colors } = theme;
  const vars: Record<string, string> = {
    '--color-primary': colors.primary,
    '--color-secondary': colors.secondary,
    '--color-accent': colors.accent,
    '--color-background': colors.background,
    '--color-surface': colors.surface,
    '--color-text': colors.text,
    '--color-text-muted': colors.textMuted,
    '--color-border': colors.border,
    '--color-success': colors.success,
    '--color-warning': colors.warning,
    '--color-error': colors.error,
    '--color-info': colors.info,
  };

  if (theme.logo) {
    vars['--theme-logo'] = `url("${theme.logo}")`;
  }

  if (theme.customVariables) {
    for (const [name, value] of Object.entries(theme.customVariables)) {
      const key = name.startsWith('--') ? name : `--${name}`;
      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Generate a CSS string containing the theme's custom properties.
 */
export function generateCSS(theme: Theme, selector = ':root'): string {
  const vars = generateCSSVariables(theme);
  const body = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

/* -------------------------------------------------------------------------- */
/* Applying themes                                                            */
/* -------------------------------------------------------------------------- */

const MANAGED_VARIABLES = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  '--color-background',
  '--color-surface',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-success',
  '--color-warning',
  '--color-error',
  '--color-info',
  '--theme-logo',
];

/**
 * Apply a theme by setting CSS custom properties on document.documentElement
 * and toggling the light/dark classes.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Remove previously managed variables so switching themes does not leave
  // stale values behind.
  for (const name of MANAGED_VARIABLES) {
    root.style.removeProperty(name);
  }

  const vars = generateCSSVariables(theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  root.classList.toggle('dark', theme.mode === 'dark');
  root.classList.toggle('light', theme.mode === 'light');
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-theme-mode', theme.mode);
}

/**
 * Remove all theme variables and classes from the document root.
 */
export function resetTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of MANAGED_VARIABLES) {
    root.style.removeProperty(name);
  }
  root.classList.remove('dark', 'light');
  root.removeAttribute('data-theme');
  root.removeAttribute('data-theme-mode');
}

/* -------------------------------------------------------------------------- */
/* Import / export                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Serialize a theme to a JSON string.
 */
export function exportTheme(theme: Theme): string {
  return JSON.stringify(theme, null, 2);
}

/**
 * Parse and validate a theme from a JSON string.
 * Throws an Error when the JSON is invalid or required fields are missing.
 */
export function importTheme(json: string): Theme {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid theme JSON: unable to parse.');
  }
  return normalizeTheme(parsed);
}

/**
 * Validate and normalize an arbitrary object into a Theme.
 */
export function normalizeTheme(input: unknown): Theme {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid theme: expected an object.');
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !obj.id) {
    throw new Error('Invalid theme: missing "id".');
  }
  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error('Invalid theme: missing "name".');
  }
  const mode: ThemeMode = obj.mode === 'dark' ? 'dark' : 'light';

  const colorsInput = obj.colors;
  if (!colorsInput || typeof colorsInput !== 'object') {
    throw new Error('Invalid theme: missing "colors".');
  }
  const c = colorsInput as Record<string, unknown>;
  const required: Array<keyof ThemeColors> = [
    'primary',
    'secondary',
    'accent',
    'background',
    'surface',
    'text',
    'textMuted',
    'border',
    'success',
    'warning',
    'error',
    'info',
  ];
  const colors = {} as ThemeColors;
  for (const key of required) {
    const value = c[key];
    if (typeof value !== 'string' || !value) {
      throw new Error(`Invalid theme: missing color "${key}".`);
    }
    colors[key] = value;
  }

  const theme: Theme = {
    id: obj.id,
    name: obj.name,
    mode,
    colors,
  };

  if (typeof obj.logo === 'string' && obj.logo) {
    theme.logo = obj.logo;
  }

  if (obj.customVariables && typeof obj.customVariables === 'object') {
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      obj.customVariables as Record<string, unknown>,
    )) {
      if (typeof v === 'string') custom[k] = v;
    }
    if (Object.keys(custom).length > 0) {
      theme.customVariables = custom;
    }
  }

  return theme;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Persist a theme to localStorage under the 'custom-theme' key.
 */
export function saveTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, exportTheme(theme));
  } catch {
    // Ignore storage errors (quota, privacy mode, etc.).
  }
}

/**
 * Load a persisted theme from localStorage. Returns null when none exists
 * or the stored value is invalid.
 */
export function loadTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return importTheme(raw);
  } catch {
    return null;
  }
}

/**
 * Remove the persisted theme from localStorage.
 */
export function clearTheme(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/* -------------------------------------------------------------------------- */
/* Preset themes                                                              */
/* -------------------------------------------------------------------------- */

export const PRESET_THEMES: Theme[] = [
  {
    id: 'default-light',
    name: 'Default Light',
    mode: 'light',
    colors: {
      primary: '#2563eb',
      secondary: '#7c3aed',
      accent: '#0ea5e9',
      background: '#ffffff',
      surface: '#f8fafc',
      text: '#0f172a',
      textMuted: '#64748b',
      border: '#e2e8f0',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0284c7',
    },
  },
  {
    id: 'default-dark',
    name: 'Default Dark',
    mode: 'dark',
    colors: {
      primary: '#3b82f6',
      secondary: '#a78bfa',
      accent: '#38bdf8',
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f1f5f9',
      textMuted: '#94a3b8',
      border: '#334155',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#0ea5e9',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    mode: 'light',
    colors: {
      primary: '#0369a1',
      secondary: '#0891b2',
      accent: '#06b6d4',
      background: '#f0f9ff',
      surface: '#e0f2fe',
      text: '#082f49',
      textMuted: '#0c4a6e',
      border: '#bae6fd',
      success: '#059669',
      warning: '#ca8a04',
      error: '#dc2626',
      info: '#0284c7',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'light',
    colors: {
      primary: '#15803d',
      secondary: '#4d7c0f',
      accent: '#65a30d',
      background: '#f7fee7',
      surface: '#ecfccb',
      text: '#14532d',
      textMuted: '#3f6212',
      border: '#d9f99d',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0284c7',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    mode: 'light',
    colors: {
      primary: '#c2410c',
      secondary: '#be123c',
      accent: '#f97316',
      background: '#fff7ed',
      surface: '#ffedd5',
      text: '#431407',
      textMuted: '#7c2d12',
      border: '#fed7aa',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0284c7',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    colors: {
      primary: '#818cf8',
      secondary: '#c084fc',
      accent: '#22d3ee',
      background: '#020617',
      surface: '#0f172a',
      text: '#e2e8f0',
      textMuted: '#94a3b8',
      border: '#1e293b',
      success: '#4ade80',
      warning: '#fbbf24',
      error: '#f87171',
      info: '#38bdf8',
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    mode: 'light',
    colors: {
      primary: '#171717',
      secondary: '#404040',
      accent: '#525252',
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#0a0a0a',
      textMuted: '#737373',
      border: '#e5e5e5',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0284c7',
    },
  },
  {
    id: 'corporate',
    name: 'Corporate',
    mode: 'light',
    colors: {
      primary: '#1e40af',
      secondary: '#1e3a8a',
      accent: '#3b82f6',
      background: '#ffffff',
      surface: '#f1f5f9',
      text: '#0f172a',
      textMuted: '#475569',
      border: '#cbd5e1',
      success: '#15803d',
      warning: '#b45309',
      error: '#b91c1c',
      info: '#0369a1',
    },
  },
];

/**
 * Look up a preset theme by id.
 */
export function getPresetTheme(id: string): Theme | undefined {
  return PRESET_THEMES.find((theme) => theme.id === id);
}

/**
 * Create a new theme by cloning a base theme with overrides.
 */
export function createTheme(
  base: Theme,
  overrides: Partial<Omit<Theme, 'colors'>> & { colors?: Partial<ThemeColors> },
): Theme {
  return {
    ...base,
    ...overrides,
    colors: {
      ...base.colors,
      ...(overrides.colors ?? {}),
    },
  };
}