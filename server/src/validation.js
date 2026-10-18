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
    query: looseObject(queryFields),
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
