/**
 * Web Crypto API utilities for encrypting and decrypting credential data.
 * Uses AES-GCM (256-bit key) with random 12-byte IV.
 */

export interface EncryptedPayload {
  iv: string; // base64url encoded
  ciphertext: string; // base64url encoded
  expiresAt: number; // unix timestamp in ms
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
    raw,
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
      iv,
    },
    key,
    ciphertext
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
