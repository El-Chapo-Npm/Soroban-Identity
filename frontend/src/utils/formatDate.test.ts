import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatLedgerExpiry,
  ledgerSequenceToUnixSeconds,
  toISO8601,
} from './formatDate';

describe('toISO8601 (Safari-safe date normalisation)', () => {
  it('converts a ledger-sequence string to ISO 8601', () => {
    const seq = 1_000_000;
    const expected = new Date(ledgerSequenceToUnixSeconds(seq) * 1000).toISOString();
    expect(toISO8601(String(seq))).toBe(expected);
    expect(toISO8601(seq)).toBe(expected);
    expect(toISO8601(BigInt(seq))).toBe(expected);
  });

  it('treats large numeric values as Unix seconds', () => {
    expect(toISO8601('1700000000')).toBe('2023-11-14T22:13:20.000Z');
    expect(toISO8601(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('normalises space-separated date strings Safari cannot parse', () => {
    expect(toISO8601('2024-01-15 10:30:00')).toBe('2024-01-15T10:30:00.000Z');
    expect(toISO8601('2024-01-15 10:30:00 +0200')).toBe('2024-01-15T08:30:00.000Z');
    expect(toISO8601('2024-01-15T10:30:00Z')).toBe('2024-01-15T10:30:00.000Z');
    expect(toISO8601('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
  });

  it('returns null for empty, zero and unparseable input', () => {
    expect(toISO8601(null)).toBeNull();
    expect(toISO8601(undefined)).toBeNull();
    expect(toISO8601('')).toBeNull();
    expect(toISO8601('0')).toBeNull();
    expect(toISO8601(0)).toBeNull();
    expect(toISO8601('not a date')).toBeNull();
  });
});

describe('formatLedgerExpiry', () => {
  it('never renders Invalid Date', () => {
    for (const v of ['1000000', 1_000_000, 1_700_000_000n, '2024-01-15 10:30:00', 'garbage', '']) {
      expect(formatLedgerExpiry(v)).not.toMatch(/invalid date/i);
    }
  });

  it('shows No expiry for zero or empty values', () => {
    expect(formatLedgerExpiry(0)).toBe('No expiry');
    expect(formatLedgerExpiry('')).toBe('No expiry');
    expect(formatLedgerExpiry(null)).toBe('No expiry');
  });

  it('formats a ledger-sequence string as a readable date', () => {
    expect(formatLedgerExpiry('1000000')).toMatch(/2020/);
  });

  it('falls back to the raw string when it cannot be parsed', () => {
    expect(formatLedgerExpiry('garbage')).toBe('garbage');
  });
});

describe('formatDate string path', () => {
  it('handles Safari-incompatible date strings', () => {
    expect(formatDate('2024-01-15 10:30:00')).toMatch(/2024/);
  });
});
