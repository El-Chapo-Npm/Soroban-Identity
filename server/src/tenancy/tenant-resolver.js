import { DEFAULT_TENANT_ID } from './tenant-registry.js';

/**
 * Extract tenant identifier from HTTP request using multiple strategies:
 * 1. Explicit Header: `x-tenant-id`
 * 2. Subdomain: `<tenant>.identity.example.com` or `<tenant>.localhost`
 * 3. JWT claim: `tenant_id` or `tenant` from decoded authorization payload
 * 4. Query param fallback: `?tenant_id=`
 * 5. Fallback: DEFAULT_TENANT_ID ('default')
 */
export function resolveTenantId(req) {
  // Strategy 1: Explicit Header
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant && typeof headerTenant === 'string' && headerTenant.trim()) {
    return headerTenant.trim();
  }

  // Strategy 2: JWT claim from req.auth / req.user / Authorization header
  if (req.user?.tenant_id) return String(req.user.tenant_id);
  if (req.auth?.tenant_id) return String(req.auth.tenant_id);
  if (req.user?.tenant) return String(req.user.tenant);
  if (req.auth?.tenant) return String(req.auth.tenant);

  // Parse JWT token in Authorization header if present
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const parts = authHeader.slice(7).split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.tenant_id) return String(payload.tenant_id);
        if (payload.tenant) return String(payload.tenant);
      }
    } catch {
      // Ignore JWT decoding failure and proceed to other strategies
    }
  }

  // Strategy 3: Subdomain
  const host = req.headers.host || '';
  const hostWithoutPort = host.split(':')[0];
  const parts = hostWithoutPort.split('.');
  if (parts.length >= 2) {
    const candidate = parts[0].toLowerCase();
    // Exclude common apex domain names like www, api, localhost
    if (candidate !== 'www' && candidate !== 'api' && candidate !== 'localhost' && !candidate.match(/^\d+$/)) {
      return candidate;
    }
  }

  // Strategy 4: Query parameter (from URL)
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const paramTenant = url.searchParams.get('tenant_id');
    if (paramTenant && paramTenant.trim()) {
      return paramTenant.trim();
    }
  } catch {
    // Ignore URL parse error
  }

  return DEFAULT_TENANT_ID;
}
