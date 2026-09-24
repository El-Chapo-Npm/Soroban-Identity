import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantRegistry } from '../src/tenancy/tenant-registry.js';
import { resolveTenantId } from '../src/tenancy/tenant-resolver.js';
import { TenantStorage, getTenantScopedConfig } from '../src/tenancy/tenant-storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Multi-tenant: TenantRegistry CRUD and isolated configurations', async (t) => {
  const testDataDir = path.join('./data/test-tenants-' + Date.now());
  const registry = new TenantRegistry({ dataDir: testDataDir });

  await t.test('initializes with default tenant', async () => {
    await registry.init();
    const defaultTenant = registry.getTenant('default');
    assert.ok(defaultTenant, 'Default tenant should exist');
    assert.equal(defaultTenant.id, 'default');
  });

  await t.test('creates and provisions a new tenant with custom contracts and rate limits', async () => {
    const tenant = await registry.createTenant({
      id: 'acme-corp',
      name: 'Acme Corp',
      subdomain: 'acme',
      tier: 'pro',
      contracts: {
        identityRegistry: 'C_ACME_IDENTITY_123',
        credentialManager: 'C_ACME_CREDENTIAL_456',
        reputation: 'C_ACME_REP_789',
      },
      rateLimits: { readsPerMinute: 300, writesPerMinute: 100 },
      quotas: { maxCredentials: 5000, maxDids: 2000 },
      admins: ['admin@acme.com'],
    });

    assert.equal(tenant.id, 'acme-corp');
    assert.equal(tenant.contracts.identityRegistry, 'C_ACME_IDENTITY_123');
    assert.equal(tenant.tier, 'pro');

    const bySubdomain = registry.getTenantBySubdomain('acme');
    assert.ok(bySubdomain);
    assert.equal(bySubdomain.id, 'acme-corp');
  });

  await t.test('updates tenant settings and admins', async () => {
    await registry.updateTenant('acme-corp', {
      branding: { primaryColor: '#ff0000' },
    });
    const updated = registry.getTenant('acme-corp');
    assert.equal(updated.branding.primaryColor, '#ff0000');

    await registry.addAdmin('acme-corp', 'security@acme.com');
    const withAdmin = registry.getTenant('acme-corp');
    assert.ok(withAdmin.admins.includes('security@acme.com'));

    await registry.removeAdmin('acme-corp', 'admin@acme.com');
    const afterRemoval = registry.getTenant('acme-corp');
    assert.ok(!afterRemoval.admins.includes('admin@acme.com'));
  });

  await t.test('tenant resolution extracts tenant from header, subdomain, or fallback', () => {
    // Header
    const reqWithHeader = { headers: { 'x-tenant-id': 'org-alpha' } };
    assert.equal(resolveTenantId(reqWithHeader), 'org-alpha');

    // Subdomain
    const reqWithSubdomain = { headers: { host: 'org-beta.identity.stellar.org:3000' } };
    assert.equal(resolveTenantId(reqWithSubdomain), 'org-beta');

    // Default fallback
    const reqDefault = { headers: { host: 'localhost:3000' } };
    assert.equal(resolveTenantId(reqDefault), 'default');
  });

  await t.test('tenant storage isolates file paths per tenant', () => {
    const baseConfig = { dataDir: testDataDir };
    const scopedAcme = getTenantScopedConfig(baseConfig, 'acme-corp');
    const scopedDefault = getTenantScopedConfig(baseConfig, 'default');

    assert.ok(scopedAcme.credentialStorePath.includes('tenants/acme-corp'));
    assert.ok(scopedDefault.credentialStorePath.includes('tenants/default'));
    assert.notEqual(scopedAcme.credentialStorePath, scopedDefault.credentialStorePath);
  });

  // Cleanup test dir
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});
