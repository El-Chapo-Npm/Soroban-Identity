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
 * Get tenant-isolated configuration with tenant-scoped storage paths.
 * E.g., data/tenants/<tenantId>/credentials.json
 */
export function getTenantScopedConfig(baseConfig, tenantId = DEFAULT_TENANT_ID) {
  const safeTenantId = (tenantId || DEFAULT_TENANT_ID).replace(/[^a-zA-Z0-9_-]/g, '_');
  const tenantDir = path.join(baseConfig.dataDir || './data', 'tenants', safeTenantId);

  return {
    ...baseConfig,
    tenantId: safeTenantId,
    dataDir: tenantDir,
    credentialStorePath: path.join(tenantDir, 'credentials.json'),
    auditLogPath: path.join(tenantDir, 'audit-log'),
    webhookStorePath: path.join(tenantDir, 'webhooks.json'),
    quotaStorePath: path.join(tenantDir, 'quota.json'),
  };
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

  getScopedConfig(tenantId = this.getTenantId()) {
    return getTenantScopedConfig(this.baseConfig, tenantId);
  }

  async readCredentials(tenantId = this.getTenantId()) {
    const config = this.getScopedConfig(tenantId);
    const credentials = await baseReadCredentials(config);
    return credentials.map((c) => ({
      ...c,
      tenant_id: c.tenant_id || tenantId,
    }));
  }

  async createCredential(credential, tenantId = this.getTenantId()) {
    const config = this.getScopedConfig(tenantId);
    const credentialWithTenant = {
      ...credential,
      tenant_id: tenantId,
    };
    return baseCreateAndPersistCredential(config, credentialWithTenant);
  }

  async revokeCredential(id, tenantId = this.getTenantId()) {
    const config = this.getScopedConfig(tenantId);
    return baseRevokeAndPersistCredential(config, id);
  }

  async logAudit(entry, tenantId = this.getTenantId()) {
    const config = this.getScopedConfig(tenantId);
    return baseAppendAuditLog(config, {
      ...entry,
      tenant_id: tenantId,
    });
  }
}
