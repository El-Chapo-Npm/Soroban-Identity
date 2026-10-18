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
 * - GET    /api/v1/tenants/:id/limits  (Read per-tenant resource limits)
 * - PUT    /api/v1/tenants/:id/limits  (Update per-tenant resource limits)
 * - GET    /api/v1/tenants/:id/customization (Read tenant customization)
 * - PUT    /api/v1/tenants/:id/customization (Update tenant customization)
 */

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ADMIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Determine whether the request is authorized to perform administrative
 * tenant operations. Requires an authenticated admin/superadmin actor.
 */
function isAdminAuthorized(req) {
  const user = req.user;
  if (!user) return false;
  const role = user.role || user.userRole;
  return role === 'admin' || role === 'superadmin' || user.isAdmin === true;
}

/**
 * Emit an audit log entry for a tenant mutation. Failures to write the audit
 * log are logged but never block the response.
 */
async function emitAudit(auditLogger, entry) {
  if (!auditLogger) return;
  try {
    await auditLogger(entry);
  } catch (err) {
    logger.error('Failed to write tenant audit log', {
      error: err.message,
      action: entry.action,
      tenant_id: entry.tenant_id,
    });
  }
}

/**
 * Validate a tenant creation/update payload. Returns an array of error
 * messages; an empty array means the payload is valid.
 */
function validateTenantPayload(body, { requireName = false } = {}) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return ['Payload must be a JSON object'];
  }
  if (requireName) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('Field "name" is required and must be a non-empty string');
    }
  } else if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('Field "name" must be a non-empty string');
    }
  }
  if (body.tier !== undefined && typeof body.tier !== 'string') {
    errors.push('Field "tier" must be a string');
  }
  if (body.admins !== undefined) {
    if (!Array.isArray(body.admins)) {
      errors.push('Field "admins" must be an array');
    } else if (body.admins.some((email) => typeof email !== 'string' || !ADMIN_EMAIL_PATTERN.test(email))) {
      errors.push('Field "admins" must contain valid email addresses');
    }
  }
  return errors;
}

/**
 * Validate a resource-limits payload.
 */
function validateLimitsPayload(body) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return ['Payload must be a JSON object'];
  }
  const numericFields = ['max_users', 'max_storage_mb', 'max_api_requests_per_day', 'max_projects'];
  for (const field of numericFields) {
    if (body[field] !== undefined) {
      const value = body[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.push(`Field "${field}" must be a non-negative number`);
      }
    }
  }
  return errors;
}

/**
 * Validate a customization payload.
 */
function validateCustomizationPayload(body) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return ['Payload must be a JSON object'];
  }
  const stringFields = ['brand_name', 'primary_color', 'logo_url', 'custom_domain', 'support_email'];
  for (const field of stringFields) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      errors.push(`Field "${field}" must be a string`);
    }
  }
  if (body.features !== undefined) {
    if (body.features === null || typeof body.features !== 'object' || Array.isArray(body.features)) {
      errors.push('Field "features" must be an object');
    }
  }
  return errors;
}

export function handleTenantRoutes(req, res, url, tenantRegistry, auditLogger) {
  const pathname = url.pathname;
  const method = req.method;

  // Match /api/v1/tenants or /tenants
  const tenantMatch = pathname.match(/^\/(?:api\/v1\/)?tenants(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-zA-Z0-9_-]+))?$/);
  if (!tenantMatch) return false;

  const tenantId = tenantMatch[1];
  const subResource = tenantMatch[2];

  // All tenant management endpoints require admin authorization.
  if (!isAdminAuthorized(req)) {
    sendJson(res, 403, { error: 'Forbidden', message: 'Admin authorization required' });
    return true;
  }

  if (tenantId && !TENANT_ID_PATTERN.test(tenantId)) {
    sendJson(res, 400, { error: 'InvalidTenantId', message: 'Invalid tenant identifier' });
    return true;
  }

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
        const errors = validateTenantPayload(body, { requireName: true });
        if (errors.length > 0) {
          sendJson(res, 400, { error: 'ValidationError', message: errors.join('; ') });
          return;
        }
        try {
          const tenant = await tenantRegistry.createTenant(body);
          await emitAudit(auditLogger, {
            action: 'TENANT_PROVISIONED',
            tenant_id: tenant.id,
            actor: req.user?.email || 'admin',
            details: { name: tenant.name, tier: tenant.tier },
          });
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
        const errors = validateTenantPayload(body);
        if (errors.length > 0) {
          sendJson(res, 400, { error: 'ValidationError', message: errors.join('; ') });
          return;
        }
        try {
          const updated = await tenantRegistry.updateTenant(tenantId, body);
          await emitAudit(auditLogger, {
            action: 'TENANT_UPDATED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
            details: { updates: Object.keys(body) },
          });
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
        await emitAudit(auditLogger, {
          action: 'TENANT_DELETED',
          tenant_id: tenantId,
          actor: req.user?.email || 'admin',
        });
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
          if (!body || typeof body.email !== 'string' || !ADMIN_EMAIL_PATTERN.test(body.email)) {
            sendJson(res, 400, { error: 'ValidationError', message: 'A valid admin email is required' });
            return;
          }
          const updated = await tenantRegistry.addAdmin(tenantId, body.email);
          await emitAudit(auditLogger, {
            action: 'TENANT_ADMIN_ADDED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
            details: { admin: body.email },
          });
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
          if (!body || typeof body.email !== 'string' || !ADMIN_EMAIL_PATTERN.test(body.email)) {
            sendJson(res, 400, { error: 'ValidationError', message: 'A valid admin email is required' });
            return;
          }
          const updated = await tenantRegistry.removeAdmin(tenantId, body.email);
          await emitAudit(auditLogger, {
            action: 'TENANT_ADMIN_REMOVED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
            details: { admin: body.email },
          });
          sendJson(res, 200, { success: true, admins: updated.admins });
        })
        .catch((err) => {
          sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
        });
      return true;
    }
  }

  // Tenant resource limits subresource: /api/v1/tenants/:id/limits
  if (subResource === 'limits') {
    const tenant = tenantRegistry.getTenant(tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: 'TenantNotFound', message: `Tenant ${tenantId} not found` });
      return true;
    }

    if (method === 'GET') {
      sendJson(res, 200, { limits: tenant.limits || {} });
      return true;
    }

    if (method === 'PUT') {
      readJson(req)
        .then(async (body) => {
          const errors = validateLimitsPayload(body);
          if (errors.length > 0) {
            sendJson(res, 400, { error: 'ValidationError', message: errors.join('; ') });
            return;
          }
          const updated = await tenantRegistry.updateLimits(tenantId, body);
          await emitAudit(auditLogger, {
            action: 'TENANT_LIMITS_UPDATED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
            details: { limits: body },
          });
          sendJson(res, 200, { success: true, limits: updated.limits || body });
        })
        .catch((err) => {
          sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
        });
      return true;
    }
  }

  // Tenant customization subresource: /api/v1/tenants/:id/customization
  if (subResource === 'customization') {
    const tenant = tenantRegistry.getTenant(tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: 'TenantNotFound', message: `Tenant ${tenantId} not found` });
      return true;
    }

    if (method === 'GET') {
      sendJson(res, 200, { customization: tenant.customization || {} });
      return true;
    }

    if (method === 'PUT') {
      readJson(req)
        .then(async (body) => {
          const errors = validateCustomizationPayload(body);
          if (errors.length > 0) {
            sendJson(res, 400, { error: 'ValidationError', message: errors.join('; ') });
            return;
          }
          const updated = await tenantRegistry.updateCustomization(tenantId, body);
          await emitAudit(auditLogger, {
            action: 'TENANT_CUSTOMIZATION_UPDATED',
            tenant_id: tenantId,
            actor: req.user?.email || 'admin',
            details: { customization: Object.keys(body) },
          });
          sendJson(res, 200, { success: true, customization: updated.customization || body });
        })
        .catch((err) => {
          sendJson(res, 400, { error: 'InvalidPayload', message: err.message });
        });
      return true;
    }
  }

  return false;
}
