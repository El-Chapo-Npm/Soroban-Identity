import { readJson, sendJson } from '../http-utils.js';
import { logger } from '../logger.js';

/**
 * Register tenant provisioning and management API endpoints:
 * - POST   /api/v1/tenants             (Provision new tenant)
 * - GET    /api/v1/tenants             (List tenants - superadmin)
 * - GET    /api/v1/tenants/:id         (Get tenant profile/config)
 * - PUT    /api/v1/tenants/:id         (Update tenant settings, branding, contracts)
 * - DELETE /api/v1/tenants/:id         (Decommission tenant)
 * - GET    /api/v1/tenants/:id/admins  (List tenant admins)
 * - POST   /api/v1/tenants/:id/admins  (Add tenant admin)
 * - DELETE /api/v1/tenants/:id/admins  (Remove tenant admin)
 */
export function handleTenantRoutes(req, res, url, tenantRegistry, auditLogger) {
  const pathname = url.pathname;
  const method = req.method;

  // Match /api/v1/tenants or /tenants
  const tenantMatch = pathname.match(/^\/(?:api\/v1\/)?tenants(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-zA-Z0-9_-]+))?$/);
  if (!tenantMatch) return false;

  const tenantId = tenantMatch[1];
  const subResource = tenantMatch[2];

  // List all tenants: GET /api/v1/tenants
  if (method === 'GET' && !tenantId) {
    const list = tenantRegistry.listTenants();
    sendJson(res, 200, { tenants: list });
    return true;
  }

  // Provision new tenant: POST /api/v1/tenants
  if (method === 'POST' && !tenantId) {
    readJson(req)
      .then(async (body) => {
        try {
          const tenant = await tenantRegistry.createTenant(body);
          if (auditLogger) {
            await auditLogger({
              action: 'TENANT_PROVISIONED',
              tenant_id: tenant.id,
              actor: req.user?.email || 'admin',
              details: { name: tenant.name, tier: tenant.tier },
            });
          }
          sendJson(res, 201, { success: true, tenant });
        } catch (err) {
          sendJson(res, 400, { error: 'TenantCreationError', message: err.message });
        }
      })
      .catch((err) => {
        sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
      });
    return true;
  }

  // Get specific tenant: GET /api/v1/tenants/:id
  if (method === 'GET' && tenantId && !subResource) {
    const tenant = tenantRegistry.getTenant(tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: 'TenantNotFound', message: `Tenant ${tenantId} not found` });
      return true;
    }
    sendJson(res, 200, { tenant });
    return true;
  }

  // Update tenant: PUT /api/v1/tenants/:id
  if (method === 'PUT' && tenantId && !subResource) {
    readJson(req)
      .then(async (body) => {
        try {
          const updated = await tenantRegistry.updateTenant(tenantId, body);
          if (auditLogger) {
            await auditLogger({
              action: 'TENANT_UPDATED',
              tenant_id: tenantId,
              actor: req.user?.email || 'admin',
              details: { updates: Object.keys(body) },
            });
          }
          sendJson(res, 200, { success: true, tenant: updated });
        } catch (err) {
          sendJson(res, 400, { error: 'TenantUpdateError', message: err.message });
        }
      })
      .catch((err) => {
        sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
      });
    return true;
  }

  // Delete tenant: DELETE /api/v1/tenants/:id
  if (method === 'DELETE' && tenantId && !subResource) {
    tenantRegistry
      .deleteTenant(tenantId)
      .then(async (deleted) => {
        if (!deleted) {
          sendJson(res, 404, { error: 'TenantNotFound', message: `Tenant ${tenantId} not found` });
          return;
        }
        if (auditLogger) {
          await auditLogger({
            action: 'TENANT_DELETED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
          });
        }
        sendJson(res, 200, { success: true, message: `Tenant ${tenantId} deleted` });
      })
      .catch((err) => {
        sendJson(res, 400, { error: 'TenantDeleteError', message: err.message });
      });
    return true;
  }

  // Tenant Admins Subresource: /api/v1/tenants/:id/admins
  if (subResource === 'admins') {
    const tenant = tenantRegistry.getTenant(tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: 'TenantNotFound', message: `Tenant ${tenantId} not found` });
      return true;
    }

    if (method === 'GET') {
      sendJson(res, 200, { admins: tenant.admins || [] });
      return true;
    }

    if (method === 'POST') {
      readJson(req)
        .then(async (body) => {
          if (!body.email) {
            sendJson(res, 400, { error: 'MissingEmail', message: 'Admin email is required' });
            return;
          }
          const updated = await tenantRegistry.addAdmin(tenantId, body.email);
          sendJson(res, 200, { success: true, admins: updated.admins });
        })
        .catch((err) => {
          sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
        });
      return true;
    }

    if (method === 'DELETE') {
      readJson(req)
        .then(async (body) => {
          if (!body.email) {
            sendJson(res, 400, { error: 'MissingEmail', message: 'Admin email is required' });
            return;
          }
          const updated = await tenantRegistry.removeAdmin(tenantId, body.email);
          sendJson(res, 200, { success: true, admins: updated.admins });
        })
        .catch((err) => {
          sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
        });
      return true;
    }
  }

  return false;
}
