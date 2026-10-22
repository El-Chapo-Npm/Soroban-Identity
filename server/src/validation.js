import { z } from 'zod';
import { sendJson } from './http-utils.js';

export const API_SCOPES = [
  'credentials:read',
  'credentials:write',
  'admin:read',
  'admin:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
  'metrics:read',
  '*',
];

/** Stellar public key: G + 55 base32 characters. */
export const STELLAR_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
/** DID for this network: `did:stellar:<Stellar account>`. */
export const DID_RE = /^did:stellar:(G[A-Z2-7]{55})$/;

/**
 * Replace lone UTF-16 surrogates with U+FFFD and normalize to NFC so special
 * Unicode (emoji, accented text, CJK, RTL marks, unpaired surrogates) never
 * crashes serialization downstream (#1067, #1082).
 */
export function normalizeUnicodeString(value) {
  if (typeof value !== 'string') return value;
  const wellFormed =
    typeof value.toWellFormed === 'function'
      ? value.toWellFormed()
      : value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  try {
    return wellFormed.normalize('NFC');
  } catch {
    return wellFormed;
  }
}

/** Normalize Unicode, strip C0/C1 control characters, and trim. */
export function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  // eslint-disable-next-line no-control-regex
  return normalizeUnicodeString(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
}

/**
 * Sanitize DID metadata, preserving valid special Unicode (emoji, non-Latin
 * scripts, symbols, zero-width joiners) while replacing lone surrogates and
 * dropping control characters other than tab and newline (#1067, #1082).
 *
 * @param {unknown} metadata
 * @returns {Record<string, unknown>}
 */
export function sanitizeDidMetadata(metadata, depth = 0) {
  if (metadata === null || metadata === undefined) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('DID metadata must be a plain JSON object');
  }
  if (depth > 20) return {};

  const out = {};
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const key = sanitizeString(String(rawKey));
    if (!key) continue;
    out[key] = sanitizeDidMetadataValue(rawValue, depth + 1);
  }
  return out;
}

function sanitizeDidMetadataValue(value, depth) {
  if (depth > 20 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    return normalizeUnicodeString(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeDidMetadataValue(item, depth + 1));
  if (typeof value === 'object') return sanitizeDidMetadata(value, depth + 1);
  return String(value);
}

const looseObject = (shape = {}) => z.object(shape).passthrough();
const optionalText = z.string().trim().optional();
const queryFields = {
  cursor: optionalText,
  direction: z.enum(['next', 'prev']).optional(),
  fields: optionalText,
  format: optionalText,
};

export const schemas = {
  commonHeaders: looseObject({ headers: z.record(z.string(), z.unknown()).optional() }),
  listCredentials: looseObject({
    query: looseObject({
      ...queryFields,
      limit: z.coerce.number().int().min(1).max(200).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  credentialByIdParams: looseObject({
    params: looseObject({ credentialId: z.string().min(1) }),
    query: looseObject(queryFields).optional(),
  }),
  upsertDid: looseObject({
    body: z
      .object({
        did: z.string().transform(sanitizeString).refine((v) => DID_RE.test(v), {
          message: 'Must be a valid DID of the form did:stellar:<STELLAR_ACCOUNT>',
        }).optional(),
        address: z.string().transform(sanitizeString).refine((v) => STELLAR_ACCOUNT_RE.test(v), {
          message: 'Must be a valid Stellar account address (G followed by 55 base32 characters)',
        }).optional(),
        controller: z.string().transform(sanitizeString).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().default({}),
        active: z.boolean().optional(),
      })
      .strict(),
  }),
  issueCredential: looseObject({
    body: looseObject({ id: z.string().min(1) }),
  }),
  batchOperations: looseObject({
    body: looseObject({ operations: z.array(z.unknown()).min(1).max(100) }),
  }),
  graphql: looseObject({
    body: looseObject({ query: z.string().min(1), variables: z.record(z.string(), z.unknown()).optional(), operationName: optionalText }),
  }),
  addIssuer: looseObject({ body: looseObject({ issuer: z.string().min(1) }) }),
  removeIssuer: looseObject({
    body: looseObject({ issuer: z.string().min(1).optional() }),
    query: looseObject({ issuer: optionalText }),
  }),
  expiryReportQuery: looseObject({
    query: looseObject({ ...queryFields, days: z.coerce.number().int().min(1).max(3650).optional() }),
  }),
  expiryThresholds: looseObject({
    body: looseObject({ thresholds: z.array(z.coerce.number().int().min(0).max(3650)).optional() }),
  }),
  registerOAuthClient: looseObject({
    body: looseObject({
      clientName: z.string().min(1).max(200).optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20),
      scopes: z.array(z.string()).optional(),
    }),
  }),
  oauthAuthorizeQuery: looseObject({
    query: looseObject({
      response_type: z.literal('code'),
      client_id: z.string().min(1),
      redirect_uri: z.string().url(),
      scope: optionalText,
      state: optionalText,
    }),
  }),
  oauthToken: looseObject({
    body: looseObject({
      grant_type: z.enum(['authorization_code', 'refresh_token']),
      code: optionalText,
      redirect_uri: optionalText,
      refresh_token: optionalText,
      client_id: optionalText,
      client_secret: optionalText,
    }),
  }),
  oauthIntrospect: looseObject({ body: looseObject({ token: z.string().min(1), client_id: optionalText, client_secret: optionalText }) }),
  oauthRevoke: looseObject({ body: looseObject({ token: z.string().min(1), client_id: optionalText, client_secret: optionalText }) }),
  createWebhook: looseObject({
    body: looseObject({ url: z.string().url(), events: z.array(z.string()).min(1).optional(), secret: optionalText }),
  }),
  testWebhook: looseObject({ body: looseObject({ event: optionalText }) }),
  webhookLogsQuery: looseObject({ query: looseObject({ ...queryFields, limit: z.coerce.number().int().min(1).max(200).optional() }) }),
  createApiKey: looseObject({
    body: looseObject({ name: z.string().min(1).optional(), scopes: z.array(z.string()).optional(), tier: optionalText }),
  }),
  rotateApiKey: looseObject({ body: looseObject({ name: optionalText }) }),
  keyExchange: looseObject({
    body: looseObject({
      clientPublicKey: z.string().min(1),
      keyId: optionalText,
      algorithm: z.enum(['AES-GCM']).optional(),
    }),
  }),
  encryptionSession: looseObject({
    body: looseObject({
      clientPublicKey: z.string().min(1),
      keyId: optionalText,
      algorithm: z.enum(['AES-GCM']).optional(),
    }),
  }),
  keyExchangeResponse: looseObject({
    body: looseObject({
      keyId: z.string().min(1),
      serverPublicKey: z.string().min(1),
      algorithm: z.enum(['AES-GCM']),
      expiresAt: z.string().min(1),
      rotationIntervalSeconds: z.coerce.number().int().min(1).optional(),
    }),
  }),
  rotateEncryptionKey: looseObject({
    body: looseObject({ keyId: optionalText }),
  }),
  encryptedEnvelope: looseObject({
    body: looseObject({
      keyId: z.string().min(1),
      algorithm: z.enum(['AES-GCM']),
      iv: z.string().min(1),
      ciphertext: z.string().min(1),
      tag: z.string().min(1),
      aad: optionalText,
    }),
  }),
};

function normalizeInput(input = {}) {
  const normalized = { ...input };
  if (input.query instanceof URLSearchParams) {
    normalized.query = Object.fromEntries(input.query.entries());
  }
  return normalized;
}

/** Validate a request fragment and send a consistent client error on failure. */
export function validateRequest(res, schema, input = {}) {
  const result = schema.safeParse(normalizeInput(input));
  if (result.success) return { ok: true, data: result.data };

  const errors = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || 'request',
    source: issue.path[0] ?? 'request',
    message: issue.message,
    code: issue.code,
  }));
  sendJson(res, 400, {
    error: 'validation_failed',
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed.',
    errors,
  });
  return { ok: false, errors };
}
