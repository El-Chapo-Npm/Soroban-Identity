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
    const tenantId = resolveTenantId(req);
    let tenant = tenantRegistry.getTenant(tenantId);

    // If tenant does not exist and isn't default, resolve by subdomain check
    if (!tenant) {
      tenant = tenantRegistry.getTenantBySubdomain(tenantId);
    }

    if (!tenant && tenantId !== DEFAULT_TENANT_ID) {
      // Unknown tenant
      sendJson(res, 404, {
        error: 'TenantNotFound',
        message: `Tenant "${tenantId}" not recognized`,
      });
      return;
    }

    // Fall back to default tenant if not found
    if (!tenant) {
      tenant = tenantRegistry.getTenant(DEFAULT_TENANT_ID);
    }

    // Attach to request
    req.tenantId = tenant ? tenant.id : DEFAULT_TENANT_ID;
    req.tenant = tenant;
    req.tenantConfig = getTenantScopedConfig(baseConfig, req.tenantId);

    // Set response header for tracking
    res.setHeader('X-Tenant-Id', req.tenantId);

    // Run inside requestContextStore with tenant context
    const currentContext = requestContextStore.getStore() || {};
    requestContextStore.run(
      {
        ...currentContext,
        tenantId: req.tenantId,
        tenant,
      },
      () => {
        next();
      }
    );
  };
}
