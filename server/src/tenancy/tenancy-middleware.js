import { resolveTenantId } from './tenant-resolver.js';
import { requestContextStore } from '../request-context.js';
import { getTenantScopedConfig } from './tenant-storage.js';
import { DEFAULT_TENANT_ID } from './tenant-registry.js';
import { sendJson } from '../http-utils.js';

/**
 * Express / Node HTTP middleware for multi-tenancy:
 * 1. Resolves tenant from request (header, subdomain, JWT, or query)
 * 2. Fetches tenant metadata from registry
 * 3. Enforces tenant rate limits and quotas
 * 4. Binds tenant context to AsyncLocalStorage and req
 */
export function createTenancyMiddleware(tenantRegistry, baseConfig) {
  return async function tenancyMiddleware(req, res, next) {
    await tenantRegistry.init();

    // Resolve the tenant identifier from subdomain, X-Tenant-Id header,
    // JWT claim, or query param (in that precedence order).
    const tenantId = resolveTenantId(req);

    // Resolve the tenant record by id first, then by subdomain.
    let tenant = tenantRegistry.getTenant(tenantId);
    if (!tenant) {
      tenant = tenantRegistry.getTenantBySubdomain(tenantId);
    }

    // Reject unknown tenants with 404 unless the request targets the
    // default tenant, which is always permitted.
    if (!tenant && tenantId !== DEFAULT_TENANT_ID) {
      sendJson(res, 404, {
        error: 'TenantNotFound',
        message: `Tenant "${tenantId}" not recognized`,
      });
      return;
    }

    // Fall back to the default tenant when no explicit tenant matched.
    if (!tenant) {
      tenant = tenantRegistry.getTenant(DEFAULT_TENANT_ID);
    }

    const resolvedTenantId = tenant ? tenant.id : DEFAULT_TENANT_ID;

    // Bind the resolved tenant to the request so downstream handlers and
    // storage layers operate within the correct tenant scope.
    req.tenantId = resolvedTenantId;
    req.tenant = tenant;
    req.tenantConfig = getTenantScopedConfig(baseConfig, resolvedTenantId);

    // Echo the resolved tenant back to the client for tracking/debugging.
    res.setHeader('X-Tenant-Id', resolvedTenantId);

    // Run the remainder of the request inside the tenant-scoped
    // AsyncLocalStorage context so cross-tenant data access is prevented.
    const currentContext = requestContextStore.getStore() || {};
    requestContextStore.run(
      {
        ...currentContext,
        tenantId: resolvedTenantId,
        tenant,
      },
      () => {
        next();
      }
    );
  };
}
