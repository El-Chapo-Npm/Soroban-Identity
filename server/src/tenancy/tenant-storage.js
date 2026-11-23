import path from 'node:path';
import fs from 'node:fs/promises';
import {
  readCredentials as baseReadCredentials,
  createAndPersistCredential as baseCreateAndPersistCredential,
  revokeAndPersistCredential as baseRevokeAndPersistCredential,
  appendAuditLog as baseAppendAuditLog,
} from '../storage.js';
import { DEFAULT_TENANT_ID } from './tenant-registry.js';
import { requestContextStore } from '../request-context.js';

/**
 * Error thrown when a read/write attempts to touch data belonging to a
 * tenant other than the one active in the current request context.
 */
export class CrossTenantAccessError extends Error {
  constructor(activeTenantId, requestedTenantId) {
    super(
      `Cross-tenant access denied: active tenant "${activeTenantId}" cannot access data for tenant "${requestedTenantId}"`,
    );
    this.name = 'CrossTenantAccessError';
    this.code = 'CROSS_TENANT_ACCESS_DENIED';
    this.activeTenantId = activeTenantId;
    this.requestedTenantId = requestedTenantId;
  }
}

/**
 * Normalize a tenant id into a filesystem-safe token.
 */
export function sanitizeTenantId(tenantId) {
  return (tenantId || DEFAULT_TENANT_ID).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Get tenant-isolated configuration with tenant-scoped storage paths.
 * E.g., data/tenants/<tenantId>/credentials.json
 */
export function getTenantScopedConfig(baseConfig, tenantId = DEFAULT_TENANT_ID) {
  const safeTenantId = sanitizeTenantId(tenantId);
  const tenantDir = path.join(baseConfig.dataDir || './data', 'tenants', safeTenantId);

  return {
    ...baseConfig,
    tenantId: safeTenantId,
    dataDir: tenantDir,
    credentialStorePath: path.join(tenantDir, 'credentials.json'),
    auditLogPath: path.join(tenantDir, 'audit-log'),
    webhookStorePath: path.join(tenantDir, 'webhooks.json'),
    quotaStorePath: path.join(tenantDir, 'quota.json'),
    customizationPath: path.join(tenantDir, 'customization.json'),
  };
}

/**
 * Per-tenant customization defaults. Tenants may override branding,
 * contracts and feature flags; anything not overridden falls back here.
 */
export const DEFAULT_TENANT_CUSTOMIZATION = Object.freeze({
  branding: {
    name: 'Default Tenant',
    logoUrl: null,
    primaryColor: '#000000',
    supportEmail: null,
  },
  contracts: {
    plan: 'standard',
    termsVersion: '1.0',
    billingContact: null,
  },
  featureFlags: {},
});

/**
 * Deep-merge a tenant's stored customization over the defaults so callers
 * always receive a complete, tenant-specific configuration object.
 */
function mergeCustomization(base, override) {
  if (!override || typeof override !== 'object') {
    return base;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      merged[key] = mergeCustomization(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Isolated tenant storage wrapper ensuring data isolation and tenant_id tag on models
 */
export class TenantStorage {
  constructor(baseConfig) {
    this.baseConfig = baseConfig;
  }

  getTenantId() {
    const context = requestContextStore.getStore();
    return context?.tenantId || DEFAULT_TENANT_ID;
  }

  /**
   * Guard that rejects any access whose target tenant does not match the
   * tenant active in the current request context. This is the single choke
   * point used by every read/write path to prevent cross-tenant access.
   */
  assertTenantAccess(requestedTenantId) {
    const activeTenantId = this.getTenantId();
    const normalizedRequested = sanitizeTenantId(requestedTenantId);
    const normalizedActive = sanitizeTenantId(activeTenantId);
    if (normalizedRequested !== normalizedActive) {
      throw new CrossTenantAccessError(normalizedActive, normalizedRequested);
    }
    return normalizedRequested;
  }

  getScopedConfig(tenantId = this.getTenantId()) {
    const safeTenantId = this.assertTenantAccess(tenantId);
    return getTenantScopedConfig(this.baseConfig, safeTenantId);
  }

  /**
   * Resolve the tenant id for a read/write, enforcing isolation. When an
   * explicit tenantId is supplied it must match the active context.
   */
  resolveTenantId(tenantId) {
    return this.assertTenantAccess(tenantId ?? this.getTenantId());
  }

  async readCredentials(tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    const credentials = await baseReadCredentials(config);
    return credentials.map((c) => ({
      ...c,
      tenant_id: c.tenant_id || safeTenantId,
    }));
  }

  async createCredential(credential, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    const credentialWithTenant = {
      ...credential,
      tenant_id: safeTenantId,
    };
    return baseCreateAndPersistCredential(config, credentialWithTenant);
  }

  async revokeCredential(id, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    return baseRevokeAndPersistCredential(config, id);
  }

  async logAudit(entry, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    return baseAppendAuditLog(config, {
      ...entry,
      tenant_id: safeTenantId,
    });
  }

  async readWebhooks(tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    try {
      const raw = await fs.readFile(config.webhookStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      const webhooks = Array.isArray(parsed) ? parsed : parsed?.webhooks || [];
      return webhooks.map((w) => ({
        ...w,
        tenant_id: w.tenant_id || safeTenantId,
      }));
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async writeWebhooks(webhooks, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    const tagged = (webhooks || []).map((w) => ({
      ...w,
      tenant_id: safeTenantId,
    }));
    await fs.mkdir(path.dirname(config.webhookStorePath), { recursive: true });
    await fs.writeFile(
      config.webhookStorePath,
      JSON.stringify(tagged, null, 2),
      'utf8',
    );
    return tagged;
  }

  async readQuota(tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    try {
      const raw = await fs.readFile(config.quotaStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        tenant_id: parsed?.tenant_id || safeTenantId,
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { tenant_id: safeTenantId };
      }
      throw err;
    }
  }

  async writeQuota(quota, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = this.getScopedConfig(safeTenantId);
    const tagged = {
      ...quota,
      tenant_id: safeTenantId,
    };
    await fs.mkdir(path.dirname(config.quotaStorePath), { recursive: true });
    await fs.writeFile(
      config.quotaStorePath,
      JSON.stringify(tagged, null, 2),
      'utf8',
    );
    return tagged;
  }

  /**
   * Read the tenant's customization config (branding, contracts, feature
   * flags), merged over the defaults. Always scoped to the active tenant.
   */
  async getTenantScopedConfig(tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = getTenantScopedConfig(this.baseConfig, safeTenantId);
    let stored = null;
    try {
      const raw = await fs.readFile(config.customizationPath, 'utf8');
      stored = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    return {
      tenantId: safeTenantId,
      ...mergeCustomization(DEFAULT_TENANT_CUSTOMIZATION, stored),
    };
  }

  /**
   * Persist tenant-specific customization overrides. Scoped to the active
   * tenant; cross-tenant writes are rejected by resolveTenantId.
   */
  async setTenantCustomization(customization, tenantId = this.getTenantId()) {
    const safeTenantId = this.resolveTenantId(tenantId);
    const config = getTenantScopedConfig(this.baseConfig, safeTenantId);
    const tagged = {
      ...customization,
      tenant_id: safeTenantId,
    };
    await fs.mkdir(path.dirname(config.customizationPath), { recursive: true });
    await fs.writeFile(
      config.customizationPath,
      JSON.stringify(tagged, null, 2),
      'utf8',
    );
    return {
      tenantId: safeTenantId,
      ...mergeCustomization(DEFAULT_TENANT_CUSTOMIZATION, tagged),
    };
  }
}
