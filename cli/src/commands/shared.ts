import { readFileSync } from 'node:fs';
import { loadConfig, type CliConfig } from '../config';

export interface GlobalOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
  input?: boolean;
  network?: string;
  rpcUrl?: string;
}

/** Load config and apply per-invocation `--network` / `--rpc-url` overrides. */
export function effectiveConfig(globals: GlobalOptions): CliConfig {
  const overrides: CliConfig = {};
  if (globals.network) overrides.network = globals.network as CliConfig['network'];
  if (globals.rpcUrl) overrides.rpcUrl = globals.rpcUrl;
  return loadConfig(globals.config, overrides).config;
}

/** Collect repeatable `--claim key=value` flags. */
export function collectClaim(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const idx = value.indexOf('=');
  if (idx <= 0) throw new Error(`Invalid claim "${value}". Expected key=value.`);
  return { ...previous, [value.slice(0, idx)]: value.slice(idx + 1) };
}

/** Collect repeatable `--meta key=value` flags. */
export const collectMeta = collectClaim;

export function readJsonObject(path: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}

/**
 * Parse an expiry into Unix seconds. Accepts `0`/`never`, a Unix timestamp,
 * an ISO-8601 date, or a relative duration like `30d`, `12h`, `90m`.
 */
export function parseExpiry(value: string | undefined): number {
  if (!value || value === '0' || value === 'never') return 0;
  const rel = /^\+?(\d+)([dhm])$/.exec(value);
  if (rel) {
    const unit = { d: 86_400, h: 3_600, m: 60 }[rel[2] as 'd' | 'h' | 'm'];
    return Math.floor(Date.now() / 1000) + Number(rel[1]) * unit;
  }
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid expiry "${value}". Use 30d, an ISO date, or a Unix timestamp.`);
  return Math.floor(ms / 1000);
}
