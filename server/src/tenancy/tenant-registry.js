import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

export const DEFAULT_TENANT_ID = 'default';

/**
 * Default per-tier resource limits. Used when a tenant does not specify
 * explicit quotas/rate limits.
 */
export const TIER_LIMITS = {
  free: {
    rateLimits: { readsPerMinute: 60, writesPerMinute: 20 },
    quotas: { maxCredentials: 500, maxDids: 200 },
  },
  pro: {
    rateLimits: { readsPerMinute: 300, writesPerMinute: 100 },
    quotas: { maxCredentials: 10000, maxDids: 5000 },
  },
  enterprise: {
    rateLimits: { readsPerMinute: 1200, writesPerMinute: 500 },
    quotas: { maxCredentials: 100000, maxDids: 50000 },
  },
};

/**
 * Validate a numeric limit value. Must be a finite, non-negative integer.
 */
function validateLimit(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Invalid ${field}: must be a non-negative integer`);
  }
  return value;
}

/**
 * Validate and normalize a rate limits object, merging with a base.
 */
export function validateRateLimits(rateLimits, base = {}) {
  if (rateLimits === undefined || rateLimits === null) return { ...base };
  if (typeof rateLimits !== 'object' || Array.isArray(rateLimits)) {
    throw new Error('Invalid rateLimits: must be an object');
  }
  const merged = { ...base, ...rateLimits };
  const result = {};
  for (const key of ['readsPerMinute', 'writesPerMinute']) {
    if (merged[key] !== undefined) {
      result[key] = validateLimit(merged[key], `rateLimits.${key}`);
    }
  }
  return result;
}

/**
 * Validate and normalize a quotas object, merging with a base.
 */
export function validateQuotas(quotas, base = {}) {
  if (quotas === undefined || quotas === null) return { ...base };
  if (typeof quotas !== 'object' || Array.isArray(quotas)) {
    throw new Error('Invalid quotas: must be an object');
  }
  const merged = { ...base, ...quotas };
  const result = {};
  for (const key of ['maxCredentials', 'maxDids']) {
    if (merged[key] !== undefined) {
      result[key] = validateLimit(merged[key], `quotas.${key}`);
    }
  }
  return result;
}

/**
 * Validate and normalize tenant customization (branding, contracts, feature flags).
 */
export function validateCustomization(customization, base = {}) {
  if (customization === undefined || customization === null) {
    return {
      branding: { ...(base.branding || {}) },
      contracts: { ...(base.contracts || {}) },
      featureFlags: { ...(base.featureFlags || {}) },
    };
  }
  if (typeof customization !== 'object' || Array.isArray(customization)) {
    throw new Error('Invalid customization: must be an object');
  }

  const branding = { ...(base.branding || {}), ...(customization.branding || {}) };
  if (branding.primaryColor !== undefined && typeof branding.primaryColor !== 'string') {
    throw new Error('Invalid branding.primaryColor: must be a string');
  }
  if (branding.appName !== undefined && typeof branding.appName !== 'string') {
    throw new Error('Invalid branding.appName: must be a string');
  }
  if (branding.logoUrl !== undefined && typeof branding.logoUrl !== 'string') {
    throw new Error('Invalid branding.logoUrl: must be a string');
  }

  const contracts = { ...(base.contracts || {}), ...(customization.contracts || {}) };
  for (const [key, value] of Object.entries(contracts)) {
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`Invalid contracts.${key}: must be a string`);
    }
  }

  const featureFlags = { ...(base.featureFlags || {}), ...(customization.featureFlags || {}) };
  for (const [key, value] of Object.entries(featureFlags)) {
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid featureFlags.${key}: must be a boolean`);
    }
  }

  return { branding, contracts, featureFlags };
}

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
        featureFlags: {},
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

    const tier = tenantData.tier || 'free';
    const tierDefaults = TIER_LIMITS[tier] || TIER_LIMITS.free;

    const customization = validateCustomization(tenantData.customization, {
      branding: tenantData.branding || {},
      contracts: tenantData.contracts || {
        identityRegistry: '',
        credentialManager: '',
        reputation: '',
      },
      featureFlags: tenantData.featureFlags || {},
    });

    const tenant = {
      id,
      name: tenantData.name || 'Untitled Tenant',
      subdomain: tenantData.subdomain ? tenantData.subdomain.toLowerCase() : id,
      tier,
      status: 'active',
      branding: customization.branding,
      contracts: customization.contracts,
      featureFlags: customization.featureFlags,
      rateLimits: validateRateLimits(tenantData.rateLimits, tierDefaults.rateLimits),
      quotas: validateQuotas(tenantData.quotas, tierDefaults.quotas),
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

    const customization = validateCustomization(updates.customization, {
      branding: { ...tenant.branding, ...(updates.branding || {}) },
      contracts: { ...tenant.contracts, ...(updates.contracts || {}) },
      featureFlags: { ...(tenant.featureFlags || {}), ...(updates.featureFlags || {}) },
    });

    const updated = {
      ...tenant,
      ...updates,
      id: tenant.id, // Immutable ID
      branding: customization.branding,
      contracts: customization.contracts,
      featureFlags: customization.featureFlags,
      rateLimits: validateRateLimits(updates.rateLimits, tenant.rateLimits),
      quotas: validateQuotas(updates.quotas, tenant.quotas),
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, updated);
    await this._save();
    return updated;
  }

  /**
   * Read the resource limits (quotas + rate limits) for a tenant.
   */
  getTenantLimits(id) {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;
    return {
      quotas: { ...tenant.quotas },
      rateLimits: { ...tenant.rateLimits },
    };
  }

  /**
   * Update the resource limits (quotas and/or rate limits) for a tenant.
   */
  async updateTenantLimits(id, { quotas, rateLimits } = {}) {
    await this.init();
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }
    const updated = {
      ...tenant,
      quotas: validateQuotas(quotas, tenant.quotas),
      rateLimits: validateRateLimits(rateLimits, tenant.rateLimits),
      updatedAt: new Date().toISOString(),
    };
    this.tenants.set(id, updated);
    await this._save();
    return { quotas: { ...updated.quotas }, rateLimits: { ...updated.rateLimits } };
  }

  /**
   * Read the customization (branding, contracts, feature flags) for a tenant.
   */
  getTenantCustomization(id) {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;
    return {
      branding: { ...tenant.branding },
      contracts: { ...tenant.contracts },
      featureFlags: { ...(tenant.featureFlags || {}) },
    };
  }

  /**
   * Update the customization (branding, contracts, feature flags) for a tenant.
   */
  async updateTenantCustomization(id, customization = {}) {
    await this.init();
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }
    const validated = validateCustomization(customization, {
      branding: tenant.branding,
      contracts: tenant.contracts,
      featureFlags: tenant.featureFlags || {},
    });
    const updated = {
      ...tenant,
      branding: validated.branding,
      contracts: validated.contracts,
      featureFlags: validated.featureFlags,
      updatedAt: new Date().toISOString(),
    };
    this.tenants.set(id, updated);
    await this._save();
    return {
      branding: { ...updated.branding },
      contracts: { ...updated.contracts },
      featureFlags: { ...updated.featureFlags },
    };
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
