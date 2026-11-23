/**
 * Client-side HMAC request signing (#752).
 *
 * Mirrors the verifier in `server/src/request-signing.js`. The canonical
 * string built here must match the server's byte for byte, so any change to
 * one side belongs in the other in the same commit.
 *
 *     <METHOD>\n<PATH_WITH_QUERY>\n<TIMESTAMP>\n<NONCE>\n<SHA256_HEX(body)>
 *
 * Built on Web Crypto so the same code runs in a browser and in Node 18+
 * without a polyfill or a Node-only import.
 */

const SIGNATURE_VERSION = "v1";

export const SIGNATURE_HEADER = "X-Signature";
export const TIMESTAMP_HEADER = "X-Signature-Timestamp";
export const NONCE_HEADER = "X-Signature-Nonce";
export const KEY_ID_HEADER = "X-Signature-Key-Id";

/** Headers a signed request carries, ready to spread into `fetch`. */
export interface SignatureHeaders {
  [SIGNATURE_HEADER]: string;
  [TIMESTAMP_HEADER]: string;
  [NONCE_HEADER]: string;
  [KEY_ID_HEADER]?: string;
}

export interface SignRequestOptions {
  /** Signing secret returned when the API key was issued or rotated. */
  signingSecret: string;
  /** HTTP method; case is normalized. */
  method: string;
  /** Request path including any query string, e.g. `/credentials?limit=10`. */
  path: string;
  /** Exact body that will be sent. Omit or pass "" for a bodyless request. */
  body?: string;
  /**
   * API key id. Send it when the signing key differs from the key used to
   * authenticate; otherwise the server infers it from the API key.
   */
  keyId?: string;
  /** Unix seconds. Defaults to now — override only in tests. */
  timestamp?: number;
  /** Unique per request. Defaults to a random 128-bit value. */
  nonce?: string;
}

function getCrypto(): Crypto {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webCrypto?.subtle) {
    throw new Error(
      "Web Crypto is unavailable. Request signing requires Node 18+ or a browser."
    );
  }
  return webCrypto;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a random nonce. 128 bits makes an accidental repeat unreachable. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of the body, hex encoded. An empty body hashes the empty string. */
async function hashBody(body: string): Promise<string> {
  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body)
  );
  return toHex(digest);
}

/**
 * Build the canonical string the signature covers.
 *
 * Exported so a caller debugging a signature mismatch can print exactly what
 * was signed and compare it against the server's view.
 */
export async function buildCanonicalString(options: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body?: string;
}): Promise<string> {
  return [
    options.method.toUpperCase(),
    options.path,
    String(options.timestamp),
    options.nonce,
    await hashBody(options.body ?? ""),
  ].join("\n");
}

/**
 * Sign a request and return the headers to send with it.
 *
 * @example
 * ```ts
 * const body = JSON.stringify({ subject: "did:stellar:GABC..." });
 * const headers = await signRequest({
 *   signingSecret: process.env.SOROBAN_SIGNING_SECRET!,
 *   method: "POST",
 *   path: "/credentials",
 *   body,
 * });
 *
 * await fetch("https://api.example.org/credentials", {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "X-API-Key": process.env.SOROBAN_API_KEY!,
 *     ...headers,
 *   },
 *   body,
 * });
 * ```
 */
export async function signRequest(
  options: SignRequestOptions
): Promise<SignatureHeaders> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce ?? generateNonce();

  const canonical = await buildCanonicalString({
    method: options.method,
    path: options.path,
    timestamp,
    nonce,
    body: options.body,
  });

  const key = await getCrypto().subtle.importKey(
    "raw",
    new TextEncoder().encode(options.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await getCrypto().subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical)
  );

  const headers: SignatureHeaders = {
    [SIGNATURE_HEADER]: `${SIGNATURE_VERSION}=${toHex(signature)}`,
    [TIMESTAMP_HEADER]: String(timestamp),
    [NONCE_HEADER]: nonce,
  };

  if (options.keyId) headers[KEY_ID_HEADER] = options.keyId;
  return headers;
}

/**
 * Wrap `fetch` so every request through it is signed.
 *
 * Returns a drop-in replacement rather than patching the global, so an
 * application can sign calls to the identity server while leaving its other
 * traffic untouched.
 *
 * @example
 * ```ts
 * const signedFetch = createSignedFetch({
 *   signingSecret: process.env.SOROBAN_SIGNING_SECRET!,
 *   baseUrl: "https://api.example.org",
 * });
 * const res = await signedFetch("/credentials", { method: "POST", body });
 * ```
 */
export function createSignedFetch(options: {
  signingSecret: string;
  /** Origin the paths are resolved against, e.g. `https://api.example.org`. */
  baseUrl: string;
  keyId?: string;
  /** Underlying fetch, injectable for tests. */
  fetchImpl?: typeof fetch;
}): (path: string, init?: RequestInit) => Promise<Response> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  return async function signedFetch(path: string, init: RequestInit = {}) {
    const method = init.method ?? "GET";
    // Only a string body can be hashed identically on both sides; a stream or
    // FormData would serialize differently for the server than for us.
    const body = typeof init.body === "string" ? init.body : "";

    const signatureHeaders = await signRequest({
      signingSecret: options.signingSecret,
      keyId: options.keyId,
      method,
      path,
      body,
    });

    return doFetch(`${options.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...signatureHeaders },
    });
  };
}
