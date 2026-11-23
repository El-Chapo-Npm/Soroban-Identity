/**
 * Response encryption helpers.
 *
 * This module provides the public surface used by `app.js` for session key
 * negotiation and field-level request/response encryption. It is a thin
 * wrapper around the existing `EncryptionService` in `./encryption.js`.
 *
 * When no key material is configured, encryption is considered disabled and
 * every helper here degrades to a no-op so the server can start and operate
 * normally.
 */

'use strict';

const encryption = require('./encryption.js');

const ENCRYPTION_KEY_ID_HEADER = 'x-encryption-key-id';
const ENCRYPTION_ENABLED_HEADER = 'x-encryption-enabled';

/**
 * Resolve the underlying EncryptionService (if any) from the encryption module.
 * The module may export the service directly, a factory, or a singleton.
 */
function resolveEncryptionService() {
  if (!encryption) {
    return null;
  }

  if (typeof encryption.getEncryptionService === 'function') {
    try {
      return encryption.getEncryptionService();
    } catch (err) {
      return null;
    }
  }

  if (encryption.encryptionService) {
    return encryption.encryptionService;
  }

  if (encryption.default && typeof encryption.default === 'object') {
    return encryption.default;
  }

  if (typeof encryption.encrypt === 'function' || typeof encryption.rotateKey === 'function') {
    return encryption;
  }

  return null;
}

/**
 * Determine whether encryption is enabled based on config/env.
 * Defaults to false when no key material is configured.
 */
function isEncryptionEnabled(config) {
  const cfg = config || {};

  // Explicit config wins.
  if (typeof cfg.encryptionEnabled === 'boolean') {
    return cfg.encryptionEnabled;
  }
  if (cfg.encryption && typeof cfg.encryption.enabled === 'boolean') {
    return cfg.encryption.enabled;
  }

  // Environment fallbacks.
  const env = process.env || {};
  const flag = env.ENCRYPTION_ENABLED || env.RESPONSE_ENCRYPTION_ENABLED;
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  // Require key material to consider encryption enabled.
  const keyMaterial =
    cfg.encryptionKey ||
    (cfg.encryption && cfg.encryption.key) ||
    env.ENCRYPTION_KEY ||
    env.RESPONSE_ENCRYPTION_KEY;

  return Boolean(keyMaterial);
}

/**
 * Thin wrapper around the existing EncryptionService so `app.js` can
 * construct a registry of session keys.
 */
class SessionKeyRegistry {
  constructor(options) {
    const opts = options || {};
    this.options = opts;
    this.enabled = isEncryptionEnabled(opts.config || opts);
    this.service = opts.service || resolveEncryptionService();
    this.sessions = new Map();
  }

  /**
   * Register a session key for a given session/tenant identifier.
   */
  register(sessionId, keyMaterial) {
    if (!this.enabled || !sessionId) {
      return null;
    }
    const entry = {
      sessionId,
      keyMaterial,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, entry);
    return entry;
  }

  /**
   * Retrieve a registered session key.
   */
  get(sessionId) {
    if (!this.enabled || !sessionId) {
      return null;
    }
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Remove a registered session key.
   */
  remove(sessionId) {
    if (!sessionId) {
      return false;
    }
    return this.sessions.delete(sessionId);
  }

  /**
   * Clear all registered session keys.
   */
  clear() {
    this.sessions.clear();
  }

  /**
   * Whether this registry is active.
   */
  isEnabled() {
    return this.enabled;
  }
}

/**
 * Negotiate a session key for an incoming request.
 * Returns null when encryption is disabled.
 */
function negotiateSessionKey(req, registry, config) {
  if (!isEncryptionEnabled(config)) {
    return null;
  }

  const keyId =
    (req && req.headers && req.headers[ENCRYPTION_KEY_ID_HEADER]) ||
    (req && req.headers && req.headers[ENCRYPTION_ENABLED_HEADER] && null) ||
    null;

  if (!keyId) {
    return null;
  }

  if (registry && typeof registry.get === 'function') {
    return registry.get(keyId);
  }

  return null;
}

/**
 * Express-style middleware that wraps responses with encryption headers.
 * No-op when encryption is disabled.
 */
function wrapResponseEncryption(options) {
  const opts = options || {};
  const enabled = isEncryptionEnabled(opts.config || opts);

  return function responseEncryptionMiddleware(req, res, next) {
    if (typeof next !== 'function') {
      return;
    }

    if (!enabled) {
      return next();
    }

    try {
      if (res && typeof res.setHeader === 'function') {
        res.setHeader(ENCRYPTION_ENABLED_HEADER, 'true');
        const session = negotiateSessionKey(req, opts.registry, opts.config || opts);
        if (session && session.sessionId) {
          res.setHeader(ENCRYPTION_KEY_ID_HEADER, session.sessionId);
        }
      }
    } catch (err) {
      // Never fail a request because of encryption header handling.
    }

    return next();
  };
}

/**
 * Encrypt sensitive fields of a response payload.
 * Returns the payload unchanged when encryption is disabled.
 */
function encryptSensitiveResponseFields(payload, fields, options) {
  const opts = options || {};
  if (!isEncryptionEnabled(opts.config || opts)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const service = opts.service || resolveEncryptionService();
  if (!service || typeof service.encrypt !== 'function') {
    return payload;
  }

  const fieldList = Array.isArray(fields) ? fields : [];
  const result = Array.isArray(payload) ? payload.slice() : Object.assign({}, payload);

  for (const field of fieldList) {
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      try {
        result[field] = service.encrypt(result[field]);
      } catch (err) {
        // Leave the field untouched on failure.
      }
    }
  }

  return result;
}

/**
 * Decrypt sensitive fields of a request payload.
 * Returns the payload unchanged when encryption is disabled.
 */
function decryptSensitiveRequestFields(payload, fields, options) {
  const opts = options || {};
  if (!isEncryptionEnabled(opts.config || opts)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const service = opts.service || resolveEncryptionService();
  if (!service || typeof service.decrypt !== 'function') {
    return payload;
  }

  const fieldList = Array.isArray(fields) ? fields : [];
  const result = Array.isArray(payload) ? payload.slice() : Object.assign({}, payload);

  for (const field of fieldList) {
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      try {
        result[field] = service.decrypt(result[field]);
      } catch (err) {
        // Leave the field untouched on failure.
      }
    }
  }

  return result;
}

module.exports = {
  SessionKeyRegistry,
  isEncryptionEnabled,
  wrapResponseEncryption,
  negotiateSessionKey,
  encryptSensitiveResponseFields,
  decryptSensitiveRequestFields,
  ENCRYPTION_KEY_ID_HEADER,
  ENCRYPTION_ENABLED_HEADER,
};