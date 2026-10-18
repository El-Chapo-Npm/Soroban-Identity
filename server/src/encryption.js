'use strict';

/**
 * server/src/encryption.js
 *
 * Session key exchange and AES-256-GCM response encryption for sensitive
 * credential data in transit.
 *
 * Encryption scheme
 * -----------------
 * - Each session is assigned a random 256-bit (32-byte) symmetric key.
 * - Keys are identified by a key id (`kid`), a random hex string. A session
 *   may hold several keys at once (rotation), but only the most recently
 *   generated key is "current" and used for encryption.
 * - Key exchange: the client calls the key-exchange handler, which returns
 *   the session key id and the key material ("wrapped key"). The wrapping
 *   step is pluggable via `wrapKey`/`unwrapKey` options so deployments can
 *   substitute an asymmetric (e.g. RSA-OAEP / ECDH-derived) wrapping scheme;
 *   the default is a base64 encoding of the raw key for transport over an
 *   already-protected channel (TLS).
 * - Payload encryption: AES-256-GCM with a random 12-byte IV per message.
 *   The GCM authentication tag (16 bytes) is appended to the ciphertext and
 *   verified on decryption, providing authenticated encryption.
 * - Rotation: `rotateKey(sessionId)` generates a new key with a new key id
 *   and marks it current. Previously issued keys are retained until they
 *   expire (`keyTtlMs`) so in-flight responses encrypted with an older key
 *   can still be decrypted. Expired keys are pruned lazily.
 *
 * Wire format for encrypted values
 * --------------------------------
 *   {
 *     kid: '<key id>',
 *     iv: '<base64 12-byte iv>',
 *     tag: '<base64 16-byte auth tag>',
 *     data: '<base64 ciphertext>',
 *     alg: 'AES-256-GCM'
 *   }
 *
 * This module is consumed by the app middleware and the key-exchange route.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32; // 256-bit keys
const IV_LENGTH_BYTES = 12; // recommended GCM nonce size
const AUTH_TAG_LENGTH_BYTES = 16;

const DEFAULT_KEY_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_KEYS_PER_SESSION = 4;

/**
 * Default key wrapping: base64-encode the raw key material. This assumes the
 * exchange happens over a channel that is already confidential (e.g. TLS).
 * Override with `wrapKey`/`unwrapKey` for end-to-end wrapping.
 */
function defaultWrapKey(rawKey) {
  return Buffer.from(rawKey).toString('base64');
}

function defaultUnwrapKey(wrappedKey) {
  return Buffer.from(wrappedKey, 'base64');
}

class EncryptionService {
  /**
   * @param {object} [options]
   * @param {number} [options.keyTtlMs] Time a rotated-out key remains usable.
   * @param {number} [options.sessionTtlMs] Idle lifetime of a session entry.
   * @param {number} [options.maxKeysPerSession] Cap on retained keys.
   * @param {Function} [options.wrapKey] (rawKey: Buffer) => string
   * @param {Function} [options.unwrapKey] (wrappedKey: string) => Buffer
   * @param {Function} [options.now] Clock injection for tests.
   */
  constructor(options = {}) {
    this.keyTtlMs = Number.isFinite(options.keyTtlMs)
      ? options.keyTtlMs
      : DEFAULT_KEY_TTL_MS;
    this.sessionTtlMs = Number.isFinite(options.sessionTtlMs)
      ? options.sessionTtlMs
      : DEFAULT_SESSION_TTL_MS;
    this.maxKeysPerSession = Number.isFinite(options.maxKeysPerSession)
      ? options.maxKeysPerSession
      : DEFAULT_MAX_KEYS_PER_SESSION;
    this.wrapKey = typeof options.wrapKey === 'function' ? options.wrapKey : defaultWrapKey;
    this.unwrapKey =
      typeof options.unwrapKey === 'function' ? options.unwrapKey : defaultUnwrapKey;
    this.now = typeof options.now === 'function' ? options.now : Date.now;

    /** @type {Map<string, {keys: Map<string, {key: Buffer, createdAt: number, expiresAt: number, current: boolean}>, currentKid: string|null, lastUsedAt: number}>} */
    this.sessions = new Map();
  }

  /**
   * Generate a fresh 256-bit key.
   * @returns {Buffer}
   */
  generateKey() {
    return crypto.randomBytes(KEY_LENGTH_BYTES);
  }

  /**
   * Generate a new key id.
   * @returns {string}
   */
  generateKeyId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Ensure a session entry exists and is not expired.
   * @private
   */
  _getOrCreateSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new TypeError('sessionId must be a non-empty string');
    }

    const now = this.now();
    let session = this.sessions.get(sessionId);

    if (session && now - session.lastUsedAt > this.sessionTtlMs) {
      this.sessions.delete(sessionId);
      session = undefined;
    }

    if (!session) {
      session = {
        keys: new Map(),
        currentKid: null,
        lastUsedAt: now,
      };
      this.sessions.set(sessionId, session);
    }

    session.lastUsedAt = now;
    return session;
  }

  /**
   * Remove keys that have passed their expiry.
   * @private
   */
  _pruneExpiredKeys(session) {
    const now = this.now();
    for (const [kid, entry] of session.keys) {
      if (entry.expiresAt <= now) {
        session.keys.delete(kid);
        if (session.currentKid === kid) {
          session.currentKid = null;
        }
      }
    }
  }

  /**
   * Create a new key for a session and make it current.
   * @private
   * @returns {{kid: string, key: Buffer}}
   */
  _createKey(session) {
    const kid = this.generateKeyId();
    const key = this.generateKey();
    const now = this.now();

    session.keys.set(kid, {
      key,
      createdAt: now,
      expiresAt: now + this.keyTtlMs,
      current: true,
    });

    if (session.currentKid && session.keys.has(session.currentKid)) {
      session.keys.get(session.currentKid).current = false;
    }

    session.currentKid = kid;
    this._enforceKeyLimit(session);
    return { kid, key };
  }

  /**
   * Keep the number of retained keys bounded, dropping the oldest
   * non-current keys first.
   * @private
   */
  _enforceKeyLimit(session) {
    if (session.keys.size <= this.maxKeysPerSession) {
      return;
    }

    const candidates = [];
    for (const [kid, entry] of session.keys) {
      if (kid !== session.currentKid) {
        candidates.push({ kid, createdAt: entry.createdAt });
      }
    }
    candidates.sort((a, b) => a.createdAt - b.createdAt);

    while (session.keys.size > this.maxKeysPerSession && candidates.length > 0) {
      const { kid } = candidates.shift();
      session.keys.delete(kid);
    }
  }

  /**
   * Get (or lazily create) the current key for a session.
   * @param {string} sessionId
   * @returns {{kid: string, key: Buffer}}
   */
  getCurrentKey(sessionId) {
    const session = this._getOrCreateSession(sessionId);
    this._pruneExpiredKeys(session);

    if (!session.currentKid || !session.keys.has(session.currentKid)) {
      return this._createKey(session);
    }

    const entry = session.keys.get(session.currentKid);
    return { kid: session.currentKid, key: entry.key };
  }

  /**
   * Retrieve a key by id, regardless of whether it is current.
   * @param {string} sessionId
   * @param {string} kid
   * @returns {Buffer|null}
   */
  getKey(sessionId, kid) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    this._pruneExpiredKeys(session);
    const entry = session.keys.get(kid);
    return entry ? entry.key : null;
  }

  /**
   * Rotate the session key: generate a new key id and key, and make it
   * current. The previous key is retained until it expires so responses
   * already encrypted with it remain decryptable.
   *
   * @param {string} sessionId
   * @returns {{kid: string, wrappedKey: string, createdAt: number, expiresAt: number}}
   */
  rotateKey(sessionId) {
    const session = this._getOrCreateSession(sessionId);
    this._pruneExpiredKeys(session);

    const { kid, key } = this._createKey(session);
    const entry = session.keys.get(kid);

    return {
      kid,
      wrappedKey: this.wrapKey(key),
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    };
  }

  /**
   * Key-exchange handler. Returns the session key id and the wrapped key
   * material the client needs in order to decrypt responses.
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {boolean} [options.rotate=false] Force generation of a new key.
   * @returns {{kid: string, wrappedKey: string, algorithm: string, createdAt: number, expiresAt: number}}
   */
  exchangeKey(sessionId, options = {}) {
    if (options.rotate) {
      return this.rotateKey(sessionId);
    }

    const session = this._getOrCreateSession(sessionId);
    this._pruneExpiredKeys(session);

    let kid;
    let entry;

    if (!session.currentKid || !session.keys.has(session.currentKid)) {
      const created = this._createKey(session);
      kid = created.kid;
      entry = session.keys.get(kid);
    } else {
      kid = session.currentKid;
      entry = session.keys.get(kid);
    }

    return {
      kid,
      wrappedKey: this.wrapKey(entry.key),
      algorithm: ALGORITHM,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    };
  }

  /**
   * Encrypt a UTF-8 string or Buffer with the session's current key.
   *
   * @param {string} sessionId
   * @param {string|Buffer} plaintext
   * @returns {{kid: string, iv: string, tag: string, data: string, alg: string}}
   */
  encrypt(sessionId, plaintext) {
    const { kid, key } = this.getCurrentKey(sessionId);
    return this.encryptWithKey(kid, key, plaintext);
  }

  /**
   * Encrypt using an explicit key id/key. Useful when a response must be
   * encrypted with a specific (possibly rotated-out) key.
   *
   * @param {string} kid
   * @param {Buffer} key
   * @param {string|Buffer} plaintext
   * @returns {{kid: string, iv: string, tag: string, data: string, alg: string}}
   */
  encryptWithKey(kid, key, plaintext) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH_BYTES) {
      throw new TypeError('key must be a 32-byte Buffer');
    }

    const iv = crypto.randomBytes(IV_LENGTH_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });

    const input = Buffer.isBuffer(plaintext)
      ? plaintext
      : Buffer.from(String(plaintext), 'utf8');

    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      kid,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64'),
      alg: ALGORITHM,
    };
  }

  /**
   * Decrypt a payload produced by `encrypt`/`encryptWithKey`.
   *
   * @param {string} sessionId
   * @param {{kid: string, iv: string, tag: string, data: string}} payload
   * @param {object} [options]
   * @param {boolean} [options.asBuffer=false] Return a Buffer instead of a string.
   * @returns {string|Buffer}
   */
  decrypt(sessionId, payload, options = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('payload must be an object');
    }

    const { kid } = payload;
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new TypeError('payload.kid must be a non-empty string');
    }

    const key = this.getKey(sessionId, kid);
    if (!key) {
      const err = new Error(`Unknown or expired key id: ${kid}`);
      err.code = 'ENCRYPTION_KEY_NOT_FOUND';
      throw err;
    }

    return this.decryptWithKey(key, payload, options);
  }

  /**
   * Decrypt with an explicit key.
   *
   * @param {Buffer} key
   * @param {{iv: string, tag: string, data: string}} payload
   * @param {object} [options]
   * @param {boolean} [options.asBuffer=false]
   * @returns {string|Buffer}
   */
  decryptWithKey(key, payload, options = {}) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH_BYTES) {
      throw new TypeError('key must be a 32-byte Buffer');
    }
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('payload must be an object');
    }

    const { iv, tag, data } = payload;
    if (typeof iv !== 'string' || typeof tag !== 'string' || typeof data !== 'string') {
      throw new TypeError('payload must contain base64 iv, tag and data strings');
    }

    const ivBuffer = Buffer.from(iv, 'base64');
    const tagBuffer = Buffer.from(tag, 'base64');
    const dataBuffer = Buffer.from(data, 'base64');

    if (ivBuffer.length !== IV_LENGTH_BYTES) {
      throw new TypeError(`iv must be ${IV_LENGTH_BYTES} bytes`);
    }
    if (tagBuffer.length !== AUTH_TAG_LENGTH_BYTES) {
      throw new TypeError(`tag must be ${AUTH_TAG_LENGTH_BYTES} bytes`);
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(tagBuffer);

    let plaintext;
    try {
      plaintext = Buffer.concat([decipher.update(dataBuffer), decipher.final()]);
    } catch (err) {
      const wrapped = new Error('Failed to decrypt payload: authentication failed');
      wrapped.code = 'ENCRYPTION_AUTH_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }

    return options.asBuffer ? plaintext : plaintext.toString('utf8');
  }

  /**
   * Encrypt selected fields of an object, returning a shallow copy where the
   * listed fields are replaced with encrypted envelopes.
   *
   * @param {string} sessionId
   * @param {object} obj
   * @param {string[]} fields
   * @returns {object}
   */
  encryptFields(sessionId, obj, fields) {
    if (!obj || typeof obj !== 'object') {
      throw new TypeError('obj must be an object');
    }
    if (!Array.isArray(fields)) {
      throw new TypeError('fields must be an array of field names');
    }

    const out = { ...obj };
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(out, field) && out[field] !== undefined && out[field] !== null) {
        out[field] = this.encrypt(sessionId, JSON.stringify(out[field]));
      }
    }
    return out;
  }

  /**
   * Decrypt fields previously encrypted by `encryptFields`.
   *
   * @param {string} sessionId
   * @param {object} obj
   * @param {string[]} fields
   * @returns {object}
   */
  decryptFields(sessionId, obj, fields) {
    if (!obj || typeof obj !== 'object') {
      throw new TypeError('obj must be an object');
    }
    if (!Array.isArray(fields)) {
      throw new TypeError('fields must be an array of field names');
    }

    const out = { ...obj };
    for (const field of fields) {
      const value = out[field];
      if (value && typeof value === 'object' && typeof value.kid === 'string') {
        out[field] = JSON.parse(this.decrypt(sessionId, value));
      }
    }
    return out;
  }

  /**
   * Drop all keys for a session (e.g. on logout).
   * @param {string} sessionId
   * @returns {boolean} true if a session was removed.
   */
  destroySession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * Remove expired keys and idle sessions. Safe to call periodically.
   * @returns {number} number of sessions removed.
   */
  prune() {
    const now = this.now();
    let removed = 0;

    for (const [sessionId, session] of this.sessions) {
      this._pruneExpiredKeys(session);
      if (session.keys.size === 0 && now - session.lastUsedAt > this.sessionTtlMs) {
        this.sessions.delete(sessionId);
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * Introspection helper for tests and diagnostics.
   * @param {string} sessionId
   * @returns {{currentKid: string|null, kids: string[]}|null}
   */
  describeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    this._pruneExpiredKeys(session);
    return {
      currentKid: session.currentKid,
      kids: Array.from(session.keys.keys()),
    };
  }
}

const defaultService = new EncryptionService();

module.exports = {
  EncryptionService,
  defaultService,
  ALGORITHM,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
  DEFAULT_KEY_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_MAX_KEYS_PER_SESSION,
  defaultWrapKey,
  defaultUnwrapKey,
};