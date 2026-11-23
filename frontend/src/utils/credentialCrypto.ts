/**
 * Web Crypto API utilities for encrypting and decrypting credential data.
 * Uses AES-GCM (256-bit key) with random 12-byte IV.
 */

export interface EncryptedPayload {
  iv: string; // base64url encoded
  ciphertext: string; // base64url encoded
  expiresAt: number; // unix timestamp in ms
}

/**
 * Payload shape used for server-encrypted sensitive fields in API responses.
 * The server negotiates a per-session key (see key exchange) and tags each
 * encrypted field with the id of the key that produced it, enabling key
 * rotation without breaking in-flight responses.
 */
export interface ServerEncryptedField {
  keyId: string; // id of the negotiated session key used to encrypt this field
  iv: string; // base64url encoded 12-byte AES-GCM IV
  ciphertext: string; // base64url encoded AES-GCM ciphertext (includes auth tag)
}

/**
 * A negotiated session key as delivered by the key exchange protocol.
 */
export interface SessionKey {
  keyId: string; // opaque identifier, matches ServerEncryptedField.keyId
  key: string; // base64url encoded raw AES-GCM 256-bit key
  expiresAt?: number; // unix timestamp in ms, optional rotation hint
}

const SESSION_KEY_STORAGE = 'soroban_session_keys';

/**
 * In-memory cache of negotiated session keys, keyed by keyId.
 * Populated via `registerSessionKey` / `importSessionKeys`.
 */
const sessionKeyCache = new Map<string, CryptoKey>();

/**
 * Import and register a negotiated session key so it can be used to decrypt
 * server-encrypted fields. Reuses the existing AES-GCM import helper.
 */
export async function registerSessionKey(sessionKey: SessionKey): Promise<CryptoKey> {
  const key = await importEncryptionKey(sessionKey.key);
  sessionKeyCache.set(sessionKey.keyId, key);
  return key;
}

/**
 * Import and register multiple negotiated session keys at once (e.g. after a
 * key rotation the server may advertise both the previous and current key).
 */
export async function importSessionKeys(sessionKeys: SessionKey[]): Promise<void> {
  await Promise.all(sessionKeys.map((sessionKey) => registerSessionKey(sessionKey)));
}

/**
 * Look up a registered session key by id, importing it from persisted storage
 * if it is not already cached in memory.
 */
async function getSessionKey(keyId: string): Promise<CryptoKey> {
  const cached = sessionKeyCache.get(keyId);
  if (cached) {
    return cached;
  }

  try {
    const stored: SessionKey[] = JSON.parse(localStorage.getItem(SESSION_KEY_STORAGE) || '[]');
    const match = stored.find((entry) => entry.keyId === keyId);
    if (match) {
      return await registerSessionKey(match);
    }
  } catch (err) {
    console.warn('Failed to load persisted session keys:', err);
  }

  throw new Error(`No session key registered for keyId "${keyId}"`);
}

/**
 * Persist negotiated session keys so they survive page reloads. Keys are
 * short-lived and rotated by the server; callers should prune expired entries.
 */
export function persistSessionKeys(sessionKeys: SessionKey[]): void {
  try {
    localStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify(sessionKeys));
  } catch (err) {
    console.warn('Failed to persist session keys:', err);
  }
}

/**
 * Decrypt a single server-encrypted field using the session key identified by
 * its keyId. Uses authenticated AES-GCM decryption, so tampered ciphertexts
 * will reject rather than yield corrupted plaintext.
 */
export async function decryptServerField<T = unknown>(
  field: ServerEncryptedField
): Promise<T> {
  const key = await getSessionKey(field.keyId);
  const iv = base64UrlToBuffer(field.iv);
  const ciphertext = base64UrlToBuffer(field.ciphertext);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    ciphertext as unknown as BufferSource
  );

  const decryptedString = new TextDecoder().decode(decrypted);
  return JSON.parse(decryptedString) as T;
}

/**
 * Decrypt a server-encrypted payload string (base64url encoded JSON of a
 * ServerEncryptedField) using the negotiated session key it references.
 */
export async function decryptServerPayload<T = unknown>(
  payloadString: string
): Promise<T> {
  const jsonStr = new TextDecoder().decode(base64UrlToBuffer(payloadString));
  const field: ServerEncryptedField = JSON.parse(jsonStr);
  return decryptServerField<T>(field);
}

/**
 * Transparently decrypt sensitive fields in a credential API response.
 *
 * Any property listed in `sensitiveFields` whose value looks like a
 * ServerEncryptedField (has `keyId`, `iv` and `ciphertext`) is replaced with
 * its decrypted value. Non-encrypted values are passed through unchanged, so
 * this is safe to apply to mixed responses.
 */
export async function decryptCredentialResponse<T extends Record<string, unknown>>(
  response: T,
  sensitiveFields: string[]
): Promise<T> {
  const result: Record<string, unknown> = { ...response };

  await Promise.all(
    sensitiveFields.map(async (fieldName) => {
      const value = result[fieldName];
      if (
        value &&
        typeof value === 'object' &&
        'keyId' in value &&
        'iv' in value &&
        'ciphertext' in value
      ) {
        result[fieldName] = await decryptServerField(value as ServerEncryptedField);
      }
    })
  );

  return result as T;
}

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a random AES-GCM 256-bit symmetric key and export it as base64url.
 */
export async function generateEncryptionKey(): Promise<{ key: CryptoKey; keyString: string }> {
  const key = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );

  const exported = await window.crypto.subtle.exportKey('raw', key);
  const keyString = bufferToBase64Url(exported);
  return { key, keyString };
}

/**
 * Import a base64url encoded raw key into a CryptoKey for AES-GCM.
 */
export async function importEncryptionKey(keyString: string): Promise<CryptoKey> {
  const raw = base64UrlToBuffer(keyString);
  return window.crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
}

/**
 * Encrypt arbitrary credential data using Web Crypto AES-GCM.
 * @param data JSON serializable data to encrypt
 * @param key CryptoKey to encrypt with
 * @param expiryDurationMs Validity duration in milliseconds (default 24 hours)
 */
export async function encryptCredentialData(
  data: unknown,
  key: CryptoKey,
  expiryDurationMs: number = 24 * 60 * 60 * 1000
): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const expiresAt = Date.now() + expiryDurationMs;
  const payloadToEncrypt = JSON.stringify({
    data,
    expiresAt,
  });

  const encodedData = new TextEncoder().encode(payloadToEncrypt);
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encodedData
  );

  const payload: EncryptedPayload = {
    iv: bufferToBase64Url(iv),
    ciphertext: bufferToBase64Url(encrypted),
    expiresAt,
  };

  return bufferToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decrypt payload string using the given key string.
 * Validates expiration timestamp.
 */
export async function decryptCredentialData<T = unknown>(
  payloadString: string,
  keyString: string
): Promise<{ data: T; expiresAt: number; isExpired: boolean }> {
  const key = await importEncryptionKey(keyString);
  const jsonStr = new TextDecoder().decode(base64UrlToBuffer(payloadString));
  const payload: EncryptedPayload = JSON.parse(jsonStr);

  const now = Date.now();
  const isExpired = now > payload.expiresAt;

  const iv = base64UrlToBuffer(payload.iv);
  const ciphertext = base64UrlToBuffer(payload.ciphertext);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    ciphertext as unknown as BufferSource
  );

  const decryptedString = new TextDecoder().decode(decrypted);
  const parsed = JSON.parse(decryptedString);

  return {
    data: parsed.data as T,
    expiresAt: payload.expiresAt,
    isExpired: isExpired || (now > parsed.expiresAt),
  };
}

/**
 * Options controlling how a time-limited share link is generated.
 */
export interface ShareLinkOptions {
  /** Attributes (claim names) to disclose. If omitted, all claims are shared. */
  disclosedAttributes?: string[];
  /** Validity duration in milliseconds (default 24 hours). */
  expiryDurationMs?: number;
  /** Optional base URL for the generated link (defaults to current origin). */
  baseUrl?: string;
}

/**
 * Result of generating a time-limited share link.
 */
export interface ShareLink {
  url: string;
  expiresAt: number;
  disclosedAttributes: string[];
}

/**
 * Build a filtered share payload containing only the disclosed attributes.
 *
 * The credential is treated as a flat record of claims. Any claim not listed in
 * `disclosedAttributes` is stripped so it never leaves the client. When
 * `disclosedAttributes` is omitted, all claims are included.
 */
export function buildSharePayload(
  credential: Record<string, unknown>,
  disclosedAttributes?: string[],
  expiresAt: number = Date.now() + 24 * 60 * 60 * 1000
): { data: Record<string, unknown>; disclosedAttributes: string[]; expiresAt: number } {
  const allAttributes = Object.keys(credential);
  const attributes = disclosedAttributes
    ? allAttributes.filter((attr) => disclosedAttributes.includes(attr))
    : allAttributes;

  const data: Record<string, unknown> = {};
  for (const attr of attributes) {
    data[attr] = credential[attr];
  }

  return { data, disclosedAttributes: attributes, expiresAt };
}

/**
 * Generate a time-limited, selectively-disclosed share link.
 *
 * The filtered payload is encrypted with a fresh AES-GCM key. The key and the
 * encrypted payload are packed into the URL fragment so they are never sent to
 * the server in the request line. The recipient can decrypt the payload with
 * `decryptCredentialData` using the key embedded in the fragment.
 */
export async function generateShareLink(
  credential: Record<string, unknown>,
  options: ShareLinkOptions = {}
): Promise<ShareLink> {
  const expiryDurationMs = options.expiryDurationMs ?? 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + expiryDurationMs;

  const { data, disclosedAttributes } = buildSharePayload(
    credential,
    options.disclosedAttributes,
    expiresAt
  );

  const { key, keyString } = await generateEncryptionKey();
  const payloadString = await encryptCredentialData(data, key, expiryDurationMs);

  const baseUrl =
    options.baseUrl ??
    (typeof window !== 'undefined' && window.location
      ? `${window.location.origin}/share`
      : '/share');

  const url = `${baseUrl}#payload=${payloadString}&key=${keyString}`;

  return { url, expiresAt, disclosedAttributes };
}

/**
 * Check whether a share link payload has expired without exposing its claims.
 *
 * Only the unencrypted envelope (which carries `expiresAt`) is parsed; the
 * ciphertext is never decrypted, so no claim data is revealed.
 */
export function verifyShareLinkExpiry(payloadString: string): {
  expiresAt: number;
  isExpired: boolean;
} {
  const jsonStr = new TextDecoder().decode(base64UrlToBuffer(payloadString));
  const payload: EncryptedPayload = JSON.parse(jsonStr);
  return {
    expiresAt: payload.expiresAt,
    isExpired: Date.now() > payload.expiresAt,
  };
}

/**
 * Analytics tracking helper for share events
 */
export function trackShareEvent(event: string, properties?: Record<string, unknown>): void {
  try {
    // Custom event dispatch for analytics integrations
    const customEvent = new CustomEvent('soroban_identity_analytics', {
      detail: {
        event,
        properties,
        timestamp: new Date().toISOString(),
      },
    });
    window.dispatchEvent(customEvent);

    // Also persist recent share events to localStorage for tracking / metrics
    const existing = JSON.parse(localStorage.getItem('soroban_share_analytics') || '[]');
    existing.push({
      event,
      properties,
      timestamp: Date.now(),
    });
    // Keep last 50 events
    if (existing.length > 50) {
      existing.shift();
    }
    localStorage.setItem('soroban_share_analytics', JSON.stringify(existing));
  } catch (err) {
    console.warn('Failed to track share event:', err);
  }
}
