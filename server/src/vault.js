import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

const DEFAULT_REFRESH_FRACTION = 0.8;
const MIN_REFRESH_SECONDS = 30;

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vault secret mappings must be a JSON object');
  }
  return parsed;
}

function normaliseSecretData(payload) {
  const data = payload?.data?.data ?? payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Vault response did not contain a secret data object');
  }
  return data;
}

export class VaultLeaseManager {
  constructor({
    env = process.env,
    fetchImpl = globalThis.fetch,
    onSecrets = () => {},
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Vault requires a fetch implementation');
    this.env = env;
    this.fetch = fetchImpl;
    this.onSecrets = onSecrets;
    this.timer = null;
    this.stopped = false;
    this.leaseDurationSeconds = 0;
  }

  get enabled() {
    return this.env.VAULT_ENABLED === 'true' || Boolean(this.env.VAULT_ADDR && this.env.VAULT_SECRET_PATH);
  }

  get address() {
    return (this.env.VAULT_ADDR ?? '').replace(/\/$/, '');
  }

  get paths() {
    return (this.env.VAULT_SECRET_PATHS ?? this.env.VAULT_SECRET_PATH ?? '')
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean);
  }

  async authenticate() {
    if (this.env.VAULT_TOKEN) return this.env.VAULT_TOKEN;
    const jwt = this.env.VAULT_JWT ?? this.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const role = this.env.VAULT_ROLE;
    if (!jwt || !role) {
      throw new Error('Vault authentication requires VAULT_TOKEN or VAULT_JWT plus VAULT_ROLE');
    }
    const response = await this.fetch(`${this.address}/v1/auth/jwt/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, jwt }),
    });
    if (!response.ok) throw new Error(`Vault JWT login failed with HTTP ${response.status}`);
    const body = await response.json();
    const token = body?.auth?.client_token;
    if (!token) throw new Error('Vault JWT login response did not contain a client token');
    return token;
  }

  async writeAudit(event) {
    const auditPath = this.env.VAULT_AUDIT_LOG_PATH;
    if (!auditPath) return;
    await mkdir(path.dirname(auditPath), { recursive: true });
    await appendFile(auditPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: this.env.VAULT_SERVICE_NAME ?? 'soroban-identity',
      ...event,
    })}\n`, { mode: 0o600 });
  }

  async readSecrets() {
    if (!this.enabled) return { secrets: {}, leaseDurationSeconds: 0 };
    if (!this.address || this.paths.length === 0) {
      throw new Error('VAULT_ADDR and VAULT_SECRET_PATH are required when Vault is enabled');
    }
    const token = await this.authenticate();
    const mappings = parseJsonObject(this.env.VAULT_SECRET_MAPPINGS);
    const secrets = {};
    let leaseDurationSeconds = Number.POSITIVE_INFINITY;
    for (const secretPath of this.paths) {
      const response = await this.fetch(`${this.address}/v1/${secretPath}`, {
        headers: { 'x-vault-token': token },
      });
      if (!response.ok) throw new Error(`Vault read failed for ${secretPath} with HTTP ${response.status}`);
      const body = await response.json();
      const data = normaliseSecretData(body);
      for (const [key, value] of Object.entries(data)) {
        const envKey = mappings[`${secretPath}:${key}`] ?? mappings[key] ?? key;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          secrets[envKey] = String(value);
        }
      }
      const duration = Number(body.lease_duration ?? body.auth?.lease_duration ?? 0);
      if (duration > 0) leaseDurationSeconds = Math.min(leaseDurationSeconds, duration);
      await this.writeAudit({ action: 'read', path: secretPath, keys: Object.keys(data), leaseDurationSeconds: duration });
      logger.info({ path: secretPath, leaseDurationSeconds: duration }, 'Vault secret lease acquired');
    }
    return {
      secrets,
      leaseDurationSeconds: Number.isFinite(leaseDurationSeconds) ? leaseDurationSeconds : 0,
    };
  }

  async refresh() {
    const { secrets, leaseDurationSeconds } = await this.readSecrets();
    if (Object.keys(secrets).length > 0) {
      Object.assign(this.env, secrets);
      await this.onSecrets(secrets);
    }
    this.leaseDurationSeconds = leaseDurationSeconds;
    this.scheduleRefresh();
    return secrets;
  }

  scheduleRefresh() {
    if (this.stopped || !this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    const configured = Number(this.env.VAULT_REFRESH_INTERVAL_SECONDS ?? 0);
    const interval = configured > 0
      ? configured
      : this.leaseDurationSeconds > 0
        ? Math.max(MIN_REFRESH_SECONDS, Math.floor(this.leaseDurationSeconds * DEFAULT_REFRESH_FRACTION))
        : 15 * 60;
    this.timer = setTimeout(() => {
      this.refresh().catch((error) => {
        logger.error({ error: error.message }, 'Vault secret refresh failed; retaining the last valid lease');
        this.scheduleRefresh();
      });
    }, interval * 1000);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export async function loadVaultSecrets(options = {}) {
  const manager = new VaultLeaseManager(options);
  if (!manager.enabled) return { manager: null, secrets: {} };
  await manager.refresh();
  return { manager, secrets: Object.fromEntries(Object.entries(manager.env).filter(([key]) => key.startsWith('VAULT_'))) };
}
