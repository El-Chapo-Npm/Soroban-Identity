import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantRegistry } from '../src/tenancy/tenant-registry.js';
import { resolveTenantId } from '../src/tenancy/tenant-resolver.js';
import { TenantStorage, getTenantScopedConfig } from '../src/tenancy/tenant-storage.js';
import { TenantRouter, tenantMiddleware } from '../src/tenancy/tenant-router.js';
import { TenantManagementApi } from '../src/tenancy/tenant-management-api.js';
import { ResourceLimiter, QuotaEnforcer } from '../src/tenancy/resource-limits.js';
import { CrossTenantGuard } from '../src/tenancy/cross-tenant-guard.js';
import { TenantCustomization } from '../src/tenancy/tenant-customization.js';
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

test('Multi-tenant: database-level isolation', async (t) => {
  const testDataDir = path.join('./data/test-tenant-db-' + Date.now());
  const registry = new TenantRegistry({ dataDir: testDataDir });
  await registry.init();

  await registry.createTenant({ id: 'tenant-a', name: 'Tenant A', subdomain: 'tenanta' });
  await registry.createTenant({ id: 'tenant-b', name: 'Tenant B', subdomain: 'tenantb' });

  await t.test('each tenant gets a distinct database namespace', () => {
    const configA = getTenantScopedConfig({ dataDir: testDataDir }, 'tenant-a');
    const configB = getTenantScopedConfig({ dataDir: testDataDir }, 'tenant-b');

    assert.ok(configA.databaseNamespace.includes('tenant-a'));
    assert.ok(configB.databaseNamespace.includes('tenant-b'));
    assert.notEqual(configA.databaseNamespace, configB.databaseNamespace);
  });

  await t.test('tenant storage writes are isolated to the tenant directory', async () => {
    const storageA = new TenantStorage({ dataDir: testDataDir, tenantId: 'tenant-a' });
    const storageB = new TenantStorage({ dataDir: testDataDir, tenantId: 'tenant-b' });

    await storageA.set('shared-key', 'value-a');
    await storageB.set('shared-key', 'value-b');

    assert.equal(await storageA.get('shared-key'), 'value-a');
    assert.equal(await storageB.get('shared-key'), 'value-b');
  });

  await t.test('deleting a tenant removes only its isolated data', async () => {
    await registry.deleteTenant('tenant-a');
    assert.equal(registry.getTenant('tenant-a'), undefined);
    assert.ok(registry.getTenant('tenant-b'), 'Other tenant must remain intact');
  });

  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

test('Multi-tenant: tenant-based routing', async (t) => {
  const testDataDir = path.join('./data/test-tenant-routing-' + Date.now());
  const registry = new TenantRegistry({ dataDir: testDataDir });
  await registry.init();
  await registry.createTenant({ id: 'route-a', name: 'Route A', subdomain: 'routea' });
  await registry.createTenant({ id: 'route-b', name: 'Route B', subdomain: 'routeb' });

  const router = new TenantRouter({ registry });

  await t.test('resolves tenant from x-tenant-id header', () => {
    const req = { headers: { 'x-tenant-id': 'route-a' } };
    assert.equal(router.resolve(req), 'route-a');
  });

  await t.test('resolves tenant from subdomain', () => {
    const req = { headers: { host: 'routeb.identity.stellar.org' } };
    assert.equal(router.resolve(req), 'route-b');
  });

  await t.test('resolves tenant from JWT claim', () => {
    const req = {
      headers: {},
      user: { tenantId: 'route-b' },
    };
    assert.equal(router.resolve(req), 'route-b');
  });

  await t.test('resolves tenant from query parameter', () => {
    const req = { headers: {}, query: { tenant: 'route-a' } };
    assert.equal(router.resolve(req), 'route-a');
  });

  await t.test('falls back to default when no tenant signal is present', () => {
    const req = { headers: { host: 'localhost:3000' } };
    assert.equal(router.resolve(req), 'default');
  });

  await t.test('middleware attaches tenant context to the request', async () => {
    const middleware = tenantMiddleware({ router });
    const req = { headers: { 'x-tenant-id': 'route-a' } };
    let called = false;
    await middleware(req, {}, () => {
      called = true;
    });
    assert.ok(called, 'next() should be invoked');
    assert.equal(req.tenantId, 'route-a');
    assert.ok(req.tenant, 'Resolved tenant object should be attached');
  });

  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

test('Multi-tenant: tenant management API CRUD', async (t) => {
  const testDataDir = path.join('./data/test-tenant-api-' + Date.now());
  const registry = new TenantRegistry({ dataDir: testDataDir });
  await registry.init();
  const api = new TenantManagementApi({ registry });

  let createdId;

  await t.test('POST creates a tenant', async () => {
    const res = await api.handle({
      method: 'POST',
      path: '/tenants',
      body: { id: 'api-tenant', name: 'API Tenant', subdomain: 'apitenant' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, 'api-tenant');
    createdId = res.body.id;
  });

  await t.test('GET lists tenants', async () => {
    const res = await api.handle({ method: 'GET', path: '/tenants' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.tenants));
    assert.ok(res.body.tenants.some((tn) => tn.id === createdId));
  });

  await t.test('GET retrieves a single tenant', async () => {
    const res = await api.handle({ method: 'GET', path: `/tenants/${createdId}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdId);
  });

  await t.test('PATCH updates a tenant', async () => {
    const res = await api.handle({
      method: 'PATCH',
      path: `/tenants/${createdId}`,
      body: { name: 'API Tenant Renamed' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'API Tenant Renamed');
  });

  await t.test('DELETE removes a tenant', async () => {
    const res = await api.handle({ method: 'DELETE', path: `/tenants/${createdId}` });
    assert.equal(res.status, 204);
    const missing = await api.handle({ method: 'GET', path: `/tenants/${createdId}` });
    assert.equal(missing.status, 404);
  });

  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

test('Multi-tenant: per-tenant resource limits and quota enforcement', async (t) => {
  const limiter = new ResourceLimiter({
    limits: {
      'limited-tenant': { readsPerMinute: 2, writesPerMinute: 1, maxCredentials: 2 },
    },
  });

  await t.test('enforces read rate limits per tenant', () => {
    assert.equal(limiter.checkRead('limited-tenant'), true);
    assert.equal(limiter.checkRead('limited-tenant'), true);
    assert.equal(limiter.checkRead('limited-tenant'), false, 'Third read should be rejected');
  });

  await t.test('enforces write rate limits per tenant', () => {
    assert.equal(limiter.checkWrite('limited-tenant'), true);
    assert.equal(limiter.checkWrite('limited-tenant'), false, 'Second write should be rejected');
  });

  await t.test('rate limits are isolated between tenants', () => {
    assert.equal(limiter.checkRead('other-tenant'), true, 'Other tenant has its own budget');
  });

  await t.test('quota enforcer blocks operations beyond the credential quota', () => {
    const enforcer = new QuotaEnforcer({ quotas: { 'limited-tenant': { maxCredentials: 2 } } });
    assert.equal(enforcer.canCreateCredential('limited-tenant', 0), true);
    assert.equal(enforcer.canCreateCredential('limited-tenant', 1), true);
    assert.equal(enforcer.canCreateCredential('limited-tenant', 2), false);
  });

  await t.test('quota enforcer blocks operations beyond the DID quota', () => {
    const enforcer = new QuotaEnforcer({ quotas: { 'limited-tenant': { maxDids: 1 } } });
    assert.equal(enforcer.canCreateDid('limited-tenant', 0), true);
    assert.equal(enforcer.canCreateDid('limited-tenant', 1), false);
  });
});

test('Multi-tenant: cross-tenant data access prevention', async (t) => {
  const guard = new CrossTenantGuard();

  await t.test('allows access when tenant ids match', () => {
    assert.equal(guard.assertAccess('tenant-a', 'tenant-a'), true);
  });

  await t.test('denies access when tenant ids differ', () => {
    assert.throws(() => guard.assertAccess('tenant-a', 'tenant-b'), /cross-tenant/i);
  });

  await t.test('denies access when the resource has no tenant owner', () => {
    assert.throws(() => guard.assertAccess('tenant-a', undefined), /cross-tenant/i);
  });

  await t.test('filters a collection down to the requesting tenant', () => {
    const records = [
      { id: 1, tenantId: 'tenant-a' },
      { id: 2, tenantId: 'tenant-b' },
      { id: 3, tenantId: 'tenant-a' },
    ];
    const visible = guard.filterByTenant(records, 'tenant-a');
    assert.equal(visible.length, 2);
    assert.ok(visible.every((r) => r.tenantId === 'tenant-a'));
  });
});

test('Multi-tenant: tenant-specific customization', async (t) => {
  const testDataDir = path.join('./data/test-tenant-custom-' + Date.now());
  const registry = new TenantRegistry({ dataDir: testDataDir });
  await registry.init();
  await registry.createTenant({
    id: 'custom-tenant',
    name: 'Custom Tenant',
    subdomain: 'custom',
    branding: { primaryColor: '#123456', logoUrl: 'https://cdn.example.com/logo.png' },
    features: { advancedAnalytics: true, customDomain: false },
    locale: 'en-GB',
  });

  const customization = new TenantCustomization({ registry });

  await t.test('returns tenant branding', () => {
    const branding = customization.getBranding('custom-tenant');
    assert.equal(branding.primaryColor, '#123456');
    assert.equal(branding.logoUrl, 'https://cdn.example.com/logo.png');
  });

  await t.test('returns tenant feature flags', () => {
    const features = customization.getFeatures('custom-tenant');
    assert.equal(features.advancedAnalytics, true);
    assert.equal(features.customDomain, false);
  });

  await t.test('returns tenant locale', () => {
    assert.equal(customization.getLocale('custom-tenant'), 'en-GB');
  });

  await t.test('falls back to defaults for unknown tenants', () => {
    const branding = customization.getBranding('unknown-tenant');
    assert.ok(branding.primaryColor, 'Default branding should be provided');
  });

  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});
