/**
 * Application-level encryption at rest (#1116).
 *
 * Envelope encryption: each value is encrypted with a fresh AES-256-GCM data
 * key (DEK); the DEK is wrapped by a per-tenant key-encryption key (KEK) held
 * in a key management service. KEKs are versioned so they can be rotated
 * without re-encrypting everything at once; `rewrap` migrates old envelopes.
 *
 * Envelope format (stored as a JSON string prefixed with `enc:v1:`):
 *   { kid, ver, dek, iv, tag, data, alg: 'AES-256-GCM' }
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/** Fields encrypted by default for each stored record type. */
export const SENSITIVE_FIELDS = {
  credential: ['claims'],
  did: ['metadata.pii', 'metadata.email', 'metadata.name', 'metadata.phone'],
  apiKey: ['secret', 'key'],
};

function aesEncrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function aesDecrypt(key, { iv, tag, data }, aad) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * In-process KMS with per-tenant, versioned KEKs. Keys are derived from a
 * master key with HKDF so nothing but the master key needs to be persisted.
 * Swap for an AWS KMS / Vault Transit adapter exposing the same
 * `wrap`/`unwrap`/`currentVersion`/`rotate` interface in production.
 */
export class LocalKms {
  constructor({ masterKey = process.env.ENCRYPTION_MASTER_KEY, versions = {} } = {}) {
    if (!masterKey) throw new Error('ENCRYPTION_MASTER_KEY is required');
    this.masterKey = Buffer.from(masterKey, /^[0-9a-f]{64}$/i.test(masterKey) ? 'hex' : 'utf8');
    this.versions = { ...versions };
  }

  currentVersion(tenantId) {
    return this.versions[tenantId] ?? 1;
  }

  rotate(tenantId) {
    this.versions[tenantId] = this.currentVersion(tenantId) + 1;
    return this.versions[tenantId];
  }

  kek(tenantId, version) {
    return Buffer.from(crypto.hkdfSync('sha256', this.masterKey, Buffer.alloc(0), `kek:${tenantId}:v${version}`, 32));
  }

  async wrap(tenantId, dek) {
    const ver = this.currentVersion(tenantId);
    const { iv, tag, data } = aesEncrypt(this.kek(tenantId, ver), dek, tenantId);
    return { ver, wrapped: Buffer.concat([iv, tag, data]).toString('base64') };
  }

  async unwrap(tenantId, ver, wrapped) {
    const buf = Buffer.from(wrapped, 'base64');
    return aesDecrypt(this.kek(tenantId, ver), { iv: buf.subarray(0, 12), tag: buf.subarray(12, 28), data: buf.subarray(28) }, tenantId);
  }
}

export class FieldEncryptor {
  constructor({ kms, audit = () => {} } = {}) {
    if (!kms) throw new Error('FieldEncryptor requires a kms');
    this.kms = kms;
    this.audit = audit;
  }

  static isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  async encrypt(tenantId, value, context = '') {
    const dek = crypto.randomBytes(32);
    const { iv, tag, data } = aesEncrypt(dek, Buffer.from(JSON.stringify(value)), `${tenantId}|${context}`);
    const { ver, wrapped } = await this.kms.wrap(tenantId, dek);
    dek.fill(0);
    this.audit({ event: 'encrypt', tenantId, context, keyVersion: ver });
    return PREFIX + JSON.stringify({
      kid: tenantId,
      ver,
      dek: wrapped,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: data.toString('base64'),
      alg: 'AES-256-GCM',
    });
  }

  async decrypt(envelope, context = '') {
    if (!FieldEncryptor.isEncrypted(envelope)) return envelope;
    const env = JSON.parse(envelope.slice(PREFIX.length));
    const dek = await this.kms.unwrap(env.kid, env.ver, env.dek);
    const plain = aesDecrypt(dek, {
      iv: Buffer.from(env.iv, 'base64'),
      tag: Buffer.from(env.tag, 'base64'),
      data: Buffer.from(env.data, 'base64'),
    }, `${env.kid}|${context}`);
    dek.fill(0);
    this.audit({ event: 'decrypt', tenantId: env.kid, context, keyVersion: env.ver });
    return JSON.parse(plain.toString('utf8'));
  }

  /** Re-wrap the DEK under the tenant's current KEK version (key rotation). */
  async rewrap(envelope) {
    if (!FieldEncryptor.isEncrypted(envelope)) return envelope;
    const env = JSON.parse(envelope.slice(PREFIX.length));
    if (env.ver === this.kms.currentVersion(env.kid)) return envelope;
    const dek = await this.kms.unwrap(env.kid, env.ver, env.dek);
    const { ver, wrapped } = await this.kms.wrap(env.kid, dek);
    dek.fill(0);
    this.audit({ event: 'rewrap', tenantId: env.kid, fromVersion: env.ver, keyVersion: ver });
    return PREFIX + JSON.stringify({ ...env, ver, dek: wrapped });
  }

  async encryptFields(tenantId, record, fields) {
    const out = structuredClone(record);
    for (const path of fields) {
      const { parent, key } = locate(out, path);
      if (parent && parent[key] !== undefined && !FieldEncryptor.isEncrypted(parent[key])) {
        parent[key] = await this.encrypt(tenantId, parent[key], path);
      }
    }
    return out;
  }

  async decryptFields(record, fields) {
    const out = structuredClone(record);
    for (const path of fields) {
      const { parent, key } = locate(out, path);
      if (parent && FieldEncryptor.isEncrypted(parent[key])) parent[key] = await this.decrypt(parent[key], path);
    }
    return out;
  }
}

function locate(obj, path) {
  const keys = path.split('.');
  let parent = obj;
  for (const k of keys.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') return {};
    parent = parent[k];
  }
  return parent && typeof parent === 'object' ? { parent, key: keys.at(-1) } : {};
}

/** Encrypt a backup buffer (e.g. a database dump) for a tenant. */
export async function encryptBackup(encryptor, tenantId, buffer) {
  return Buffer.from(await encryptor.encrypt(tenantId, Buffer.from(buffer).toString('base64'), 'backup'));
}

export async function decryptBackup(encryptor, encrypted) {
  return Buffer.from(await encryptor.decrypt(Buffer.from(encrypted).toString('utf8'), 'backup'), 'base64');
}
