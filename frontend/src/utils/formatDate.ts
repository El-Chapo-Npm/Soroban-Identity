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

const MAX_DATE_SECONDS = 8_640_000_000_000; // Max ECMAScript Date in seconds (8.64e15 ms)

function normalizeUnixSeconds(value: number | bigint | string): number {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return 0;
  return num < 0 ? num >>> 0 : num;
}

export function formatDate(value: string | number): string {
  const ms = typeof value === 'number' ? normalizeUnixSeconds(value) * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'number' ? `Unix ${normalizeUnixSeconds(value)}` : String(value);
  }
  return formatFns(date, 'PPP', { locale: getDateFnsLocale() });
}

export function formatTimestamp(unix: number): string {
  const sec = normalizeUnixSeconds(unix);
  if (sec === 0) return 'No expiry';
  if (sec > MAX_DATE_SECONDS) return `Unix ${sec}`;
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return `Unix ${sec}`;
  return formatFns(date, 'PPpp', { locale: getDateFnsLocale() });
}

export function getExpiryStyle(unix: number): React.CSSProperties {
  const sec = normalizeUnixSeconds(unix);
  if (sec === 0) return { color: 'var(--text-muted)' };
  const diffSec = sec - Date.now() / 1000;
  if (diffSec < 0) return { color: 'var(--text-muted)' };
  if (diffSec < 7 * 24 * 60 * 60) return { color: 'var(--warning)', fontWeight: 600 };
  return {};
}
