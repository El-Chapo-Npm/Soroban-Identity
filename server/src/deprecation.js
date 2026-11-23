import { logger } from './logger.js';
import { renderDeprecationBody, renderDeprecationSubject } from './email.js';

/**
 * API Deprecation Warnings (#751)
 *
 * Per-endpoint deprecation, layered on top of the per-*version* deprecation
 * already handled by versioning.js (DEPRECATED_VERSIONS / Deprecation
 * header there). This module lets a specific route be sunset independently
 * of the API version it lives in.
 *
 * Seeded with one real deprecation: the bare `DELETE /credentials/:id` form.
 * It's functionally identical to `DELETE /credentials/:id/revoke` (see
 * app.js's revoke handler, which already accepts both), but its path is
 * indistinguishable from a hypothetical future "delete this resource"
 * semantic and doesn't name the action the way the `/revoke` endpoints do.
 * `/revoke` remains the only non-deprecated way to revoke a credential.
 */
export const DEPRECATED_ENDPOINTS = [
  {
    name: 'bare_credential_delete',
    method: 'DELETE',
    // Deliberately does NOT match /credentials/:id/revoke — that suffixed
    // form has one more path segment and is not deprecated.
    pattern: /^\/credentials\/[^/]+$/,
    deprecatedSince: '2026-08-27',
    sunsetDate: '2027-02-27T00:00:00Z',
    migrationUrl: 'https://github.com/Soroban-Identity/docs/API_VERSIONING.md#currently-deprecated',
    description:
      'DELETE /credentials/:id is superseded by POST /credentials/:id/revoke (or DELETE /credentials/:id/revoke), which names the action explicitly.',
  },
];

/**
 * Find the deprecation rule governing a request, if any.
 */
export function matchDeprecatedEndpoint(method, pathname, rules = DEPRECATED_ENDPOINTS) {
  const upperMethod = String(method ?? '').toUpperCase();
  return rules.find((rule) => (rule.method === null || rule.method === upperMethod) && rule.pattern.test(pathname)) ?? null;
}

/**
 * Set the deprecation headers on a matched response: `Deprecation` and
 * `Sunset` follow the same convention versioning.js already uses for
 * version-level deprecation; `Link` carries the migration guide URL per
 * RFC 8288, and the `X-Deprecated-*` headers give a client the specifics
 * without having to parse `Link`.
 */
export function setDeprecationHeaders(res, rule) {
  if (!rule) return;
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', rule.sunsetDate);
  res.setHeader('Link', `<${rule.migrationUrl}>; rel="deprecation"`);
  res.setHeader('X-Deprecated-Since', rule.deprecatedSince);
  res.setHeader('X-Deprecated-Endpoint', rule.name);
}

/**
 * Tracks per-API-key notification dedupe so an owner gets at most one
 * deprecation email per endpoint per day, and drives header-setting +
 * usage logging for every matched request.
 */
export class DeprecationRegistry {
  constructor({ rules = DEPRECATED_ENDPOINTS, onUsage = null } = {}) {
    this.rules = rules;
    this.onUsage = onUsage;
    this.notifiedOwners = new Map();
  }

  match(method, pathname) {
    return matchDeprecatedEndpoint(method, pathname, this.rules);
  }

  /**
   * Apply headers and fire the usage callback for a matched request.
   * Safe to call unconditionally — a null rule is a no-op.
   */
  handle(req, res, rule) {
    if (!rule) return;
    setDeprecationHeaders(res, rule);
    if (!this.onUsage) return;
    try {
      const result = this.onUsage({ rule, req });
      if (result && typeof result.then === 'function') {
        result.catch((error) =>
          logger.error({ error: error.message, rule: rule.name }, 'Deprecated endpoint usage callback rejected'),
        );
      }
    } catch (error) {
      logger.error({ error: error.message, rule: rule.name }, 'Deprecated endpoint usage callback failed');
    }
  }

  /**
   * Whether an API key should be notified about a rule right now, marking it
   * notified for the rest of the UTC day if so. Keyed on the date (not
   * "ever") so a key that keeps calling a deprecated endpoint is reminded
   * again each day rather than exactly once for its whole lifetime.
   */
  shouldNotify(apiKeyId, ruleName) {
    if (!apiKeyId) return false;
    const day = new Date().toISOString().slice(0, 10);
    const key = `${apiKeyId}:${ruleName}`;
    if (this.notifiedOwners.get(key) === day) return false;
    this.notifiedOwners.set(key, day);
    return true;
  }
}

/**
 * Resolve a notification recipient for an API key and deliver the
 * deprecation-usage email. Best-effort: a missing transport, key record, or
 * recipient address is a silent no-op rather than a failure.
 */
export async function notifyDeprecatedEndpointOwner({ config, apiKeyService, emailTransport, apiKeyId, rule }) {
  if (!emailTransport?.enabled || !apiKeyService || !apiKeyId) return;

  const record = await apiKeyService.getKey(apiKeyId);
  const recipient = (record?.owner && record.owner.includes('@')) ? record.owner : (config.notificationEmail || null);
  if (!recipient) return;

  const subject = renderDeprecationSubject(rule);
  const { text, html } = renderDeprecationBody(rule);

  try {
    await emailTransport.send({ to: recipient, subject, text, html });
    logger.info({ apiKeyId, rule: rule.name, recipient }, 'Deprecation notification delivered');
  } catch (error) {
    logger.error({ apiKeyId, rule: rule.name, error: error.message }, 'Deprecation notification failed');
  }
}
