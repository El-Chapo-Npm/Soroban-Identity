import crypto from 'crypto';
import ApiKeyService from '../services/api-key-service.js';

const KEY_PREFIX = 'gw_';
const KEY_BYTES = 32;

function generateRawKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString('base64url');
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function extractRawKey(req) {
  if (!req) return null;

  const header = req.headers && (req.headers['x-api-key'] || req.headers['x-gateway-key']);
  if (header) {
    return Array.isArray(header) ? header[0] : header;
  }

  const auth = req.headers && req.headers.authorization;
  if (auth && typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }

  if (req.query && (req.query.api_key || req.query.apiKey)) {
    return req.query.api_key || req.query.apiKey;
  }

  return null;
}

export async function issueKey({ name, ownerId, scopes, expiresAt, metadata } = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('A key name is required');
  }

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);

  const record = await ApiKeyService.create({
    name,
    ownerId: ownerId || null,
    keyHash,
    prefix: KEY_PREFIX,
    scopes: Array.isArray(scopes) ? scopes : [],
    expiresAt: expiresAt || null,
    metadata: metadata || {},
  });

  return { ...record, key: rawKey };
}

export async function listKeys(filter = {}) {
  return ApiKeyService.list(filter);
}

export async function getKey(id) {
  if (!id) throw new Error('A key id is required');
  return ApiKeyService.get(id);
}

export async function revokeKey(id, { reason } = {}) {
  if (!id) throw new Error('A key id is required');
  return ApiKeyService.revoke(id, { reason: reason || null });
}

export async function rotateKey(id, { expiresAt, metadata } = {}) {
  if (!id) throw new Error('A key id is required');

  const existing = await ApiKeyService.get(id);
  if (!existing) {
    throw new Error(`API key not found: ${id}`);
  }

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);

  const record = await ApiKeyService.rotate(id, {
    keyHash,
    prefix: KEY_PREFIX,
    expiresAt: expiresAt !== undefined ? expiresAt : existing.expiresAt,
    metadata: metadata !== undefined ? metadata : existing.metadata,
  });

  return { ...record, key: rawKey };
}

export async function resolveKey(req) {
  const rawKey = extractRawKey(req);
  if (!rawKey) return null;

  const keyHash = hashKey(rawKey);
  const record = await ApiKeyService.findByHash(keyHash);

  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return record;
}

export default {
  issueKey,
  listKeys,
  getKey,
  revokeKey,
  rotateKey,
  resolveKey,
};