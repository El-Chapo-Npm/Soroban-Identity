import crypto from 'node:crypto';

export const ENCRYPTION_SESSION_HEADER = 'x-encryption-session';
export const ENCRYPTION_ALGORITHM = 'A256GCM';

const HKDF_INFO = 'soroban-identity/payload-encryption/v1';
const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;
const DEFAULT_ROTATION_GRACE_SECONDS = 60;
const DEFAULT_MAX_SESSIONS = 10_000;
const MAX_PUBLIC_KEY_BYTES = 256;

export class PayloadEncryptionError extends Error {
  constructor(message, code = 'ENCRYPTED_PAYLOAD_INVALID', status = 400) {
    super(message);
    this.name = 'PayloadEncryptionError';
    this.code = code;
    this.status = status;
  }
}

function decodeBase64(value, field, { maxBytes = 1024, expectedBytes } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new PayloadEncryptionError(`Invalid encrypted payload ${field}.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length > maxBytes ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
    decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  ) {
    throw new PayloadEncryptionError(`Invalid encrypted payload ${field}.`);
  }
  return decoded;
}

function importClientPublicKey(encodedKey) {
  try {
    const der = decodeBase64(encodedKey, 'client public key', { maxBytes: MAX_PUBLIC_KEY_BYTES });
    const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'x25519') throw new Error('Unexpected key type');
    return publicKey;
  } catch (error) {
    if (error instanceof PayloadEncryptionError) throw error;
    throw new PayloadEncryptionError('clientPublicKey must be a base64-encoded X25519 SPKI public key.');
  }
}

export function deriveSessionKey(sharedSecret, salt, sessionId, keyId) {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    sharedSecret,
    salt,
    `${HKDF_INFO}\n${sessionId}\n${keyId}`,
    32,
  ));
}

function makeSessionKey(clientPublicKey, sessionId, keyId) {
  const serverPair = crypto.generateKeyPairSync('x25519');
  const sharedSecret = crypto.diffieHellman({
    privateKey: serverPair.privateKey,
    publicKey: clientPublicKey,
  });
  const salt = crypto.randomBytes(32);
  const key = deriveSessionKey(sharedSecret, salt, sessionId, keyId);
  sharedSecret.fill(0);
  return {
    key,
    exchange: {
      keyId,
      generation: Number(keyId.match(/^key-(\d+)-/)[1]),
      serverPublicKey: serverPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      salt: salt.toString('base64'),
    },
  };
}

export class EncryptionSessionStore {
  constructor({
    ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
    rotationGraceSeconds = DEFAULT_ROTATION_GRACE_SECONDS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    now = Date.now,
  } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.rotationGraceMs = rotationGraceSeconds * 1000;
    this.maxSessions = maxSessions;
    this.now = now;
    this.sessions = new Map();
  }

  create(clientPublicKey, ownerId) {
    this.prune();
    if (this.sessions.size >= this.maxSessions) {
      throw new PayloadEncryptionError('Encryption session capacity has been reached.', 'ENCRYPTION_CAPACITY', 503);
    }
    const peerKey = importClientPublicKey(clientPublicKey);
    const sessionId = crypto.randomUUID();
    const keyId = `key-1-${crypto.randomBytes(8).toString('hex')}`;
    const { key, exchange } = makeSessionKey(peerKey, sessionId, keyId);
    const expiresAt = this.now() + this.ttlMs;
    this.sessions.set(sessionId, {
      id: sessionId,
      ownerId,
      expiresAt,
      generation: 1,
      currentKeyId: keyId,
      keys: new Map([[keyId, { key, expiresAt }]]),
    });
    return this.publicSession(this.sessions.get(sessionId), exchange);
  }

  rotate(sessionId, clientPublicKey, ownerId) {
    const session = this.getSession(sessionId, ownerId);
    if (!session) {
      throw new PayloadEncryptionError('Encryption session was not found or has expired.', 'ENCRYPTION_SESSION_INVALID', 404);
    }
    const peerKey = importClientPublicKey(clientPublicKey);
    const generation = session.generation + 1;
    const keyId = `key-${generation}-${crypto.randomBytes(8).toString('hex')}`;
    const { key, exchange } = makeSessionKey(peerKey, sessionId, keyId);
    const now = this.now();
    const previousKey = session.keys.get(session.currentKeyId);
    previousKey.expiresAt = Math.min(previousKey.expiresAt, now + this.rotationGraceMs);
    session.expiresAt = now + this.ttlMs;
    session.generation = generation;
    session.currentKeyId = keyId;
    session.keys.set(keyId, { key, expiresAt: session.expiresAt });
    return this.publicSession(session, exchange);
  }

  getKey(sessionId, keyId, ownerId) {
    const session = this.getSession(sessionId, ownerId);
    if (!session) return null;
    const record = session.keys.get(keyId);
    if (!record || record.expiresAt <= this.now()) {
      session.keys.delete(keyId);
      return null;
    }
    return record.key;
  }

  getCurrentKey(sessionId, ownerId) {
    const session = this.getSession(sessionId, ownerId);
    if (!session) return null;
    return {
      keyId: session.currentKeyId,
      key: session.keys.get(session.currentKeyId).key,
    };
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    for (const { key } of session.keys.values()) key.fill(0);
    this.sessions.delete(sessionId);
    return true;
  }

  prune() {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.close(sessionId);
        continue;
      }
      for (const [keyId, record] of session.keys) {
        if (record.expiresAt <= now) {
          record.key.fill(0);
          session.keys.delete(keyId);
        }
      }
    }
  }

  getSession(sessionId, ownerId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= this.now()) {
      if (session) this.close(sessionId);
      return null;
    }
    if (ownerId !== undefined && session.ownerId !== ownerId) return null;
    return session;
  }

  publicSession(session, exchange) {
    return {
      protocol: 1,
      algorithm: ENCRYPTION_ALGORITHM,
      sessionId: session.id,
      keyId: exchange.keyId,
      generation: exchange.generation,
      serverPublicKey: exchange.serverPublicKey,
      salt: exchange.salt,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }
}

function additionalData(parts) {
  return Buffer.from(parts.join('\n'), 'utf8');
}

export function encryptAesGcm(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAesGcm(key, envelope, aad) {
  if (!envelope || (envelope.algorithm ?? envelope.encrypted) !== ENCRYPTION_ALGORITHM) {
    throw new PayloadEncryptionError('Expected an AES-GCM encrypted request envelope.');
  }
  const iv = decodeBase64(envelope.iv, 'IV', { expectedBytes: 12 });
  const ciphertext = decodeBase64(envelope.ciphertext, 'ciphertext', { maxBytes: 1024 * 1024 });
  const tag = decodeBase64(envelope.tag, 'authentication tag', { expectedBytes: 16 });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new PayloadEncryptionError('Encrypted payload authentication failed.');
  }
}

export function decryptRequestJson(req, encryptionSessionStore, sessionId, ownerId, bodyBuffer) {
  let envelope;
  try {
    envelope = JSON.parse(bodyBuffer.toString('utf8'));
  } catch {
    throw new PayloadEncryptionError('Encrypted request body must be a JSON envelope.');
  }
  const keyId = envelope?.keyId;
  if (typeof keyId !== 'string') {
    throw new PayloadEncryptionError('Encrypted request body is missing its keyId.');
  }
  const key = encryptionSessionStore.getKey(sessionId, keyId, ownerId);
  if (!key) {
    throw new PayloadEncryptionError('Encryption key was not found or has expired.', 'ENCRYPTION_KEY_INVALID', 401);
  }
  const plaintext = decryptAesGcm(
    key,
    envelope,
    requestAad(req, sessionId, keyId),
  );
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new PayloadEncryptionError('Decrypted request payload must contain valid JSON.');
  }
}

export function encryptSensitiveFields(body, {
  key,
  keyId,
  sessionId,
  method,
  path,
  statusCode,
  sensitiveFields,
}) {
  const sensitive = new Set(sensitiveFields.map((field) => field.toLowerCase()));
  function visit(value, pointer = '') {
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, `${pointer}/${index}`));
    }
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [field, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (sensitive.has(field.toLowerCase()) && child !== null && child !== undefined) {
        const encrypted = encryptAesGcm(
          key,
          JSON.stringify(child),
          responseAad({ method, path, statusCode, sessionId, keyId, fieldPath: childPointer }),
        );
        result[field] = {
          algorithm: ENCRYPTION_ALGORITHM,
          keyId,
          ...encrypted,
        };
      } else {
        result[field] = visit(child, childPointer);
      }
    }
    return result;
  }
  return visit(body);
}

export function requestAad(req, sessionId, keyId) {
  return additionalData(['request', req.method.toUpperCase(), req.url, sessionId, keyId]);
}

export function responseAad({ method, path, statusCode, sessionId, keyId, fieldPath }) {
  return additionalData([
    'response',
    method.toUpperCase(),
    path,
    String(statusCode),
    sessionId,
    keyId,
    fieldPath,
  ]);
}
