import type React from 'react';
import { format as formatFns } from 'date-fns';
import { enUS, es, fr, zhCN } from 'date-fns/locale';
import i18n from '../i18n';

const DATE_FNS_LOCALES: Record<string, typeof enUS> = {
  en: enUS,
  es,
  fr,
  zh: zhCN,
};

function getDateFnsLocale() {
  const currentLang = i18n.language ? i18n.language.split('-')[0] : 'en';
  return DATE_FNS_LOCALES[currentLang] || enUS;
}

const MAX_DATE_MS = 8_640_000_000_000_000; // ECMAScript max Date millisecond value
const MAX_DATE_SECS = 8_640_000_000_000;

// Stellar ledgers close at a target of one every 5 seconds.
export const STELLAR_LEDGER_CLOSE_SECONDS = 5;
// Unix timestamp (seconds) of the Stellar genesis ledger (ledger sequence 1).
export const STELLAR_GENESIS_UNIX_SECONDS = 1_600_000_000;

/**
 * Convert a Stellar ledger sequence to a UTC Unix timestamp (in seconds).
 *
 * Uses the accurate 5-second-per-ledger close time so the computed expiry
 * matches the on-chain value (the previous constant was off by ~5s/ledger).
 * If the caller has the actual ledger close time available it should be
 * preferred; this helper is the deterministic fallback.
 */
export function ledgerSequenceToUnixSeconds(ledgerSequence: number | bigint | string): number {
  const seq = typeof ledgerSequence === 'bigint' ? Number(ledgerSequence) : Number(ledgerSequence);
  if (!Number.isFinite(seq) || seq <= 0) return 0;
  return STELLAR_GENESIS_UNIX_SECONDS + (Math.floor(seq) - 1) * STELLAR_LEDGER_CLOSE_SECONDS;
}

/**
 * Convert a Stellar ledger sequence to a UTC Date.
 */
export function ledgerSequenceToDate(ledgerSequence: number | bigint | string): Date {
  return new Date(ledgerSequenceToUnixSeconds(ledgerSequence) * 1000);
}

export function normalizeUnixTimestamp(value: number | bigint | string): number {
  const num = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num) || num <= 0) return 0;
  // Unsigned 32-bit wrap-around recovery if a negative 32-bit signed int was produced
  if (num < 0) {
    return num + 0x100000000;
  }
  return num;
}

/**
 * Numeric values below this are Stellar ledger sequences, not Unix seconds.
 * Unix seconds passed 1e9 in 2001; ledger sequences only reach that around
 * year 2160 at 5s per ledger, so the two ranges do not overlap in practice.
 */
const LEDGER_SEQUENCE_CEILING = 1_000_000_000;

/**
 * Normalise a non-ISO date string into ISO 8601 so Safari can parse it.
 * Safari's Date parser rejects forms V8/SpiderMonkey accept, such as
 * "2024-01-15 10:30:00" (space separator) or "2024-01-15 10:30:00 +0000".
 * Strings without an explicit offset are treated as UTC.
 */
function normalizeDateString(raw: string): string {
  const value = raw.trim();
  const m = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!m) return value;
  const [, day, time, zone] = m;
  if (!time) return day;
  let offset = 'Z';
  if (zone && zone.toUpperCase() !== 'Z') {
    offset = zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  }
  return `${day}T${time}${offset}`;
}

/**
 * Convert an expiry/timestamp value to an ISO 8601 string, or null when it is
 * absent (0 / empty) or unparseable. Accepts Unix seconds, Stellar ledger
 * sequences (number, bigint or numeric string) and date strings. The result
 * is safe to hand to `new Date()` in every browser, including Safari.
 */
export function toISO8601(value: string | number | bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value === 'string' && text === '') return null;

  if (typeof value !== 'string' || /^\d+$/.test(text)) {
    const num = normalizeUnixTimestamp(typeof value === 'string' ? text : value);
    if (num === 0) return null;
    const seconds = num < LEDGER_SEQUENCE_CEILING ? ledgerSequenceToUnixSeconds(num) : num;
    if (seconds >= MAX_DATE_SECS) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(normalizeDateString(text));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Format a credential/attestation expiry for display. Never produces
 * "Invalid Date": unparseable input falls back to the raw value.
 */
export function formatLedgerExpiry(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined || value === 0 || value === 0n) return 'No expiry';
  const iso = toISO8601(value);
  if (iso === null) {
    if (typeof value === 'string' && value.trim() !== '' && !/^\d+$/.test(value.trim())) {
      return value;
    }
    const n = Number(value);
    if (Number.isFinite(n) && n >= MAX_DATE_SECS) return 'Far future (max timestamp)';
    return 'No expiry';
  }
  return formatFns(new Date(iso), 'PPP', { locale: getDateFnsLocale() });
}

export function formatDate(value: string | number | bigint): string {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const iso = toISO8601(value);
    return iso === null ? String(value) : formatFns(new Date(iso), 'PPP', { locale: getDateFnsLocale() });
  }
  const unix = normalizeUnixTimestamp(value);
  if (unix >= MAX_DATE_SECS) {
    return 'Far future (max timestamp)';
  }
  const ms = Math.min(unix * 1000, MAX_DATE_MS);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'number' ? `Unix ${normalizeUnixTimestamp(value)}` : String(value);
  }
  return formatFns(date, 'PPP', { locale: getDateFnsLocale() });
}

export function formatTimestamp(unix: number | bigint): string {
  const normalized = normalizeUnixTimestamp(unix);
  if (normalized === 0) return 'No expiry';
  if (normalized >= MAX_DATE_SECS) return 'Far future (max timestamp)';
  const date = new Date(Math.min(normalized * 1000, MAX_DATE_MS));
  return formatFns(date, 'PPpp', { locale: getDateFnsLocale() });
}

export function getExpiryStyle(unix: number | bigint): React.CSSProperties {
  const normalized = normalizeUnixTimestamp(unix);
  if (normalized === 0) return { color: 'var(--text-muted)' };
  if (normalized >= MAX_DATE_SECS) return {};
  const diffMs = normalized * 1000 - Date.now();
  if (diffMs < 0) return { color: 'var(--text-muted)' };
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return { color: 'var(--warning)', fontWeight: 600 };
  return {};
}
