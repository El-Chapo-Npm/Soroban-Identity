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

export function formatDate(value: string | number): string {
  const ms = typeof value === 'number' ? value * 1000 : value;
  const date = new Date(ms);
  return formatFns(date, 'PPP', { locale: getDateFnsLocale() });
}

export function formatTimestamp(unix: number): string {
  if (unix === 0) return 'No expiry';
  const date = new Date(unix * 1000);
  return formatFns(date, 'PPpp', { locale: getDateFnsLocale() });
}

export function getExpiryStyle(unix: number): React.CSSProperties {
  if (unix === 0) return { color: 'var(--text-muted)' };
  const diffMs = unix * 1000 - Date.now();
  if (diffMs < 0) return { color: 'var(--text-muted)' };
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return { color: 'var(--warning)', fontWeight: 600 };
  return {};
}
