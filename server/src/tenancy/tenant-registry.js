import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

export const DEFAULT_TENANT_ID = 'default';

/**
 * Tenant Registry Store
 * Manages tenant organizations, branding, contract addresses, quotas, rate limits, and admins.
 */
export class TenantRegistry {
  constructor(config = {}) {
    this.config = config;
    this.storagePath = config.tenantStorePath || path.join(config.dataDir || './data', 'tenants.json');
    this.tenants = new Map();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tenants)) {
        for (const t of parsed.tenants) {
          this.tenants.set(t.id, t);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error({ err }, 'Failed to load tenant store from disk');
      }
    }

    // Ensure default system tenant exists
    if (!this.tenants.has(DEFAULT_TENANT_ID)) {
      const defaultTenant = {
        id: DEFAULT_TENANT_ID,
        name: 'Default Organization',
        subdomain: 'default',
        tier: 'enterprise',
        status: 'active',
        branding: {
          logoUrl: '',
          primaryColor: '#0066cc',
          appName: 'Soroban Identity',
        },
        contracts: {
          identityRegistry: process.env.IDENTITY_CONTRACT_ID || '',
          credentialManager: process.env.CREDENTIAL_CONTRACT_ID || '',
          reputation: process.env.REPUTATION_CONTRACT_ID || '',
        },
        rateLimits: {
          readsPerMinute: 1200,
          writesPerMinute: 500,
        },
        quotas: {
          maxCredentials: 100000,
          maxDids: 50000,
        },
        admins: ['admin@default.org'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.tenants.set(DEFAULT_TENANT_ID, defaultTenant);
      await this._save();
    }
    this._initialized = true;
  }

  async _save() {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const data = { tenants: Array.from(this.tenants.values()) };
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logger.error({ err }, 'Failed to persist tenant registry');
    }
  }

  getTenant(id) {
    return this.tenants.get(id) || null;
  }

  getTenantBySubdomain(subdomain) {
    if (!subdomain) return null;
    const lower = subdomain.toLowerCase();
    for (const tenant of this.tenants.values()) {
      if (tenant.subdomain && tenant.subdomain.toLowerCase() === lower) {
        return tenant;
      }
    }
    return null;
  }

  listTenants() {
    return Array.from(this.tenants.values());
  }

  async createTenant(tenantData) {
    await this.init();
    const id = tenantData.id || `tenant_${crypto.randomBytes(6).toString('hex')}`;
    if (this.tenants.has(id)) {
      throw new Error(`Tenant with ID ${id} already exists`);
    }

    if (tenantData.subdomain) {
      const existing = this.getTenantBySubdomain(tenantData.subdomain);
      if (existing) {
        throw new Error(`Subdomain "${tenantData.subdomain}" is already claimed by tenant ${existing.id}`);
      }
    }

    const tenant = {
      id,
      name: tenantData.name || 'Untitled Tenant',
      subdomain: tenantData.subdomain ? tenantData.subdomain.toLowerCase() : id,
      tier: tenantData.tier || 'free',
      status: 'active',
      branding: tenantData.branding || {},
      contracts: tenantData.contracts || {
        identityRegistry: '',
        credentialManager: '',
        reputation: '',
      },
      rateLimits: tenantData.rateLimits || {
        readsPerMinute: tenantData.tier === 'pro' ? 300 : tenantData.tier === 'enterprise' ? 1200 : 60,
        writesPerMinute: tenantData.tier === 'pro' ? 100 : tenantData.tier === 'enterprise' ? 500 : 20,
      },
      quotas: tenantData.quotas || {
        maxCredentials: tenantData.tier === 'pro' ? 10000 : tenantData.tier === 'enterprise' ? 100000 : 500,
        maxDids: tenantData.tier === 'pro' ? 5000 : tenantData.tier === 'enterprise' ? 50000 : 200,
      },
      admins: Array.isArray(tenantData.admins) ? tenantData.admins : [tenantData.adminEmail || 'admin@tenant.local'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, tenant);
    await this._save();
    return tenant;
  }

  async updateTenant(id, updates) {
    await this.init();
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    if (updates.subdomain && updates.subdomain.toLowerCase() !== tenant.subdomain?.toLowerCase()) {
      const existing = this.getTenantBySubdomain(updates.subdomain);
      if (existing && existing.id !== id) {
        throw new Error(`Subdomain "${updates.subdomain}" is already claimed by tenant ${existing.id}`);
      }
    }

    const updated = {
      ...tenant,
      ...updates,
      id: tenant.id, // Immutable ID
      branding: { ...tenant.branding, ...updates.branding },
      contracts: { ...tenant.contracts, ...updates.contracts },
      rateLimits: { ...tenant.rateLimits, ...updates.rateLimits },
      quotas: { ...tenant.quotas, ...updates.quotas },
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, updated);
    await this._save();
    return updated;
  }

  async addAdmin(tenantId, adminEmail) {
    await this.init();
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    if (!tenant.admins.includes(adminEmail)) {
      tenant.admins.push(adminEmail);
      tenant.updatedAt = new Date().toISOString();
      await this._save();
    }
    return tenant;
  }

  async removeAdmin(tenantId, adminEmail) {
    await this.init();
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    tenant.admins = tenant.admins.filter((a) => a !== adminEmail);
    tenant.updatedAt = new Date().toISOString();
    await this._save();
    return tenant;
  }

  async deleteTenant(id) {
    await this.init();
    if (id === DEFAULT_TENANT_ID) {
      throw new Error('Cannot delete default system tenant');
    }
    const existed = this.tenants.delete(id);
    if (existed) {
      await this._save();
    }
    return existed;
  }
}
