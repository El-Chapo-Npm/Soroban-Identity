import { z } from 'zod';

import { stellarAddress, did } from './validators';

/**
 * Schema definition patterns
 * --------------------------
 * - Every endpoint has a request schema and a response schema.
 * - Types are inferred from schemas via `z.infer` so runtime validation and
 *   compile-time types never drift apart.
 * - Schemas are versioned: `SCHEMA_VERSION` is attached to every response
 *   envelope and can be used by clients to detect breaking changes.
 * - Custom validators (Stellar address, DID) live in `./validators` and are
 *   reused across request/response schemas.
 * - This module is the single source of truth for schemas and inferred types.
 *   Validation middleware and OpenAPI helpers are re-exported from
 *   `./middleware` so there is exactly one definition of each.
 */

export const SCHEMA_VERSION = '1.0.0';

export { stellarAddress, did };

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Credentials endpoints (v1)
// ---------------------------------------------------------------------------

export const listCredentialsRequest = z.object({
  subject: stellarAddress.optional(),
  issuer: stellarAddress.optional(),
  ...paginationQuery.shape,
});

export const listCredentialsResponse = z.object({
  credentials: z.array(
    z.object({
      id: z.string(),
      subject: stellarAddress,
      issuer: stellarAddress,
      issuedAt: z.string().datetime(),
      expiresAt: z.string().datetime().nullable(),
      revoked: z.boolean(),
    }),
  ),
  total: z.number().int().min(0),
  schemaVersion: z.string(),
});

export const getCredentialRequest = z.object({
  id: z.string().min(1),
});

export const getCredentialResponse = z.object({
  credential: z.object({
    id: z.string(),
    subject: stellarAddress,
    issuer: stellarAddress,
    claims: z.record(z.unknown()),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    revoked: z.boolean(),
  }),
  schemaVersion: z.string(),
});

export const issueCredentialRequest = z.object({
  subject: stellarAddress,
  claims: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
});

export const issueCredentialResponse = z.object({
  id: z.string(),
  subject: stellarAddress,
  issuer: stellarAddress,
  issuedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

export const revokeCredentialRequest = z.object({
  id: z.string().min(1),
  reason: z.string().max(256).optional(),
});

export const revokeCredentialResponse = z.object({
  id: z.string(),
  revoked: z.boolean(),
  revokedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

export const verifyCredentialRequest = z.object({
  id: z.string().min(1),
});

export const verifyCredentialResponse = z.object({
  id: z.string(),
  valid: z.boolean(),
  reason: z.string().optional(),
  schemaVersion: z.string(),
});

export const batchCredentialsRequest = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export const batchCredentialsResponse = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      valid: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Credentials endpoints (v2)
// ---------------------------------------------------------------------------

export const listCredentialsV2Request = z.object({
  subject: stellarAddress.optional(),
  issuer: stellarAddress.optional(),
  cursor: z.string().optional(),
  ...paginationQuery.shape,
});

export const listCredentialsV2Response = z.object({
  credentials: z.array(
    z.object({
      id: z.string(),
      subject: stellarAddress,
      issuer: stellarAddress,
      issuedAt: z.string().datetime(),
      expiresAt: z.string().datetime().nullable(),
      revoked: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
  schemaVersion: z.string(),
});

export const issueCredentialV2Request = z.object({
  subject: stellarAddress,
  claims: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const issueCredentialV2Response = z.object({
  id: z.string(),
  subject: stellarAddress,
  issuer: stellarAddress,
  issuedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Webhooks endpoints
// ---------------------------------------------------------------------------

export const listWebhooksRequest = z.object({
  ...paginationQuery.shape,
});

export const listWebhooksResponse = z.object({
  webhooks: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      events: z.array(z.string()),
      active: z.boolean(),
      createdAt: z.string().datetime(),
    }),
  ),
  total: z.number().int().min(0),
  schemaVersion: z.string(),
});

export const createWebhookRequest = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secret: z.string().min(16).optional(),
});

export const createWebhookResponse = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  schemaVersion: z.string(),
});

export const deleteWebhookRequest = z.object({
  id: z.string().min(1),
});

export const deleteWebhookResponse = z.object({
  id: z.string(),
  deleted: z.boolean(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Issuers endpoints
// ---------------------------------------------------------------------------

export const listIssuersRequest = z.object({
  ...paginationQuery.shape,
});

export const listIssuersResponse = z.object({
  issuers: z.array(
    z.object({
      address: stellarAddress,
      name: z.string(),
      verified: z.boolean(),
      credentialCount: z.number().int().min(0),
    }),
  ),
  total: z.number().int().min(0),
  schemaVersion: z.string(),
});

export const getIssuerRequest = z.object({
  address: stellarAddress,
});

export const getIssuerResponse = z.object({
  address: stellarAddress,
  name: z.string(),
  verified: z.boolean(),
  credentialCount: z.number().int().min(0),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Expiry report endpoints
// ---------------------------------------------------------------------------

export const expiryReportRequest = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).optional().default(30),
  issuer: stellarAddress.optional(),
});

export const expiryReportResponse = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      subject: stellarAddress,
      issuer: stellarAddress,
      expiresAt: z.string().datetime(),
      daysRemaining: z.number().int(),
    }),
  ),
  generatedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// API keys endpoints
// ---------------------------------------------------------------------------

export const listApiKeysRequest = z.object({
  ...paginationQuery.shape,
});

export const listApiKeysResponse = z.object({
  apiKeys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      prefix: z.string(),
      createdAt: z.string().datetime(),
      lastUsedAt: z.string().datetime().nullable(),
      revoked: z.boolean(),
    }),
  ),
  total: z.number().int().min(0),
  schemaVersion: z.string(),
});

export const createApiKeyRequest = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string().min(1)).min(1),
});

export const createApiKeyResponse = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  prefix: z.string(),
  createdAt: z.string().datetime(),
  schemaVersion: z.string(),
});

export const revokeApiKeyRequest = z.object({
  id: z.string().min(1),
});

export const revokeApiKeyResponse = z.object({
  id: z.string(),
  revoked: z.boolean(),
  revokedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// OAuth endpoints
// ---------------------------------------------------------------------------

export const oauthTokenRequest = z.object({
  grantType: z.enum(['authorization_code', 'refresh_token', 'client_credentials']),
  code: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  redirectUri: z.string().url().optional(),
});

export const oauthTokenResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().min(0),
  refreshToken: z.string().optional(),
  scope: z.string().optional(),
  schemaVersion: z.string(),
});

export const oauthAuthorizeRequest = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  responseType: z.literal('code'),
  scope: z.string().optional(),
  state: z.string().optional(),
});

export const oauthAuthorizeResponse = z.object({
  code: z.string(),
  state: z.string().optional(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// GraphQL endpoints
// ---------------------------------------------------------------------------

export const graphqlRequest = z.object({
  query: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
  operationName: z.string().optional(),
});

export const graphqlResponse = z.object({
  data: z.record(z.unknown()).nullable().optional(),
  errors: z
    .array(z.object({ message: z.string(), path: z.array(z.union([z.string(), z.number()])).optional() }))
    .optional(),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Reputation endpoints
// ---------------------------------------------------------------------------

export const submitScoreRequest = z.object({
  subject: stellarAddress,
  score: z.number().int().min(0).max(100),
  context: z.string().min(1).max(256).optional(),
});

export const submitScoreResponse = z.object({
  subject: stellarAddress,
  score: z.number().int().min(0).max(100),
  updatedAt: z.string().datetime(),
  schemaVersion: z.string(),
});

export const getScoreRequest = z.object({
  subject: stellarAddress,
});

export const getScoreResponse = z.object({
  subject: stellarAddress,
  score: z.number().int().min(0).max(100),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Identity endpoints
// ---------------------------------------------------------------------------

export const resolveDidRequest = z.object({
  did,
});

export const resolveDidResponse = z.object({
  did,
  document: z.record(z.unknown()),
  schemaVersion: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type PaginationQuery = z.infer<typeof paginationQuery>;
export type ErrorResponse = z.infer<typeof errorResponse>;

export type ListCredentialsRequest = z.infer<typeof listCredentialsRequest>;
export type ListCredentialsResponse = z.infer<typeof listCredentialsResponse>;
export type GetCredentialRequest = z.infer<typeof getCredentialRequest>;
export type GetCredentialResponse = z.infer<typeof getCredentialResponse>;
export type IssueCredentialRequest = z.infer<typeof issueCredentialRequest>;
export type IssueCredentialResponse = z.infer<typeof issueCredentialResponse>;
export type RevokeCredentialRequest = z.infer<typeof revokeCredentialRequest>;
export type RevokeCredentialResponse = z.infer<typeof revokeCredentialResponse>;
export type VerifyCredentialRequest = z.infer<typeof verifyCredentialRequest>;
export type VerifyCredentialResponse = z.infer<typeof verifyCredentialResponse>;
export type BatchCredentialsRequest = z.infer<typeof batchCredentialsRequest>;
export type BatchCredentialsResponse = z.infer<typeof batchCredentialsResponse>;

export type ListCredentialsV2Request = z.infer<typeof listCredentialsV2Request>;
export type ListCredentialsV2Response = z.infer<typeof listCredentialsV2Response>;
export type IssueCredentialV2Request = z.infer<typeof issueCredentialV2Request>;
export type IssueCredentialV2Response = z.infer<typeof issueCredentialV2Response>;

export type ListWebhooksRequest = z.infer<typeof listWebhooksRequest>;
export type ListWebhooksResponse = z.infer<typeof listWebhooksResponse>;
export type CreateWebhookRequest = z.infer<typeof createWebhookRequest>;
export type CreateWebhookResponse = z.infer<typeof createWebhookResponse>;
export type DeleteWebhookRequest = z.infer<typeof deleteWebhookRequest>;
export type DeleteWebhookResponse = z.infer<typeof deleteWebhookResponse>;

export type ListIssuersRequest = z.infer<typeof listIssuersRequest>;
export type ListIssuersResponse = z.infer<typeof listIssuersResponse>;
export type GetIssuerRequest = z.infer<typeof getIssuerRequest>;
export type GetIssuerResponse = z.infer<typeof getIssuerResponse>;

export type ExpiryReportRequest = z.infer<typeof expiryReportRequest>;
export type ExpiryReportResponse = z.infer<typeof expiryReportResponse>;

export type ListApiKeysRequest = z.infer<typeof listApiKeysRequest>;
export type ListApiKeysResponse = z.infer<typeof listApiKeysResponse>;
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequest>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponse>;
export type RevokeApiKeyRequest = z.infer<typeof revokeApiKeyRequest>;
export type RevokeApiKeyResponse = z.infer<typeof revokeApiKeyResponse>;

export type OAuthTokenRequest = z.infer<typeof oauthTokenRequest>;
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponse>;
export type OAuthAuthorizeRequest = z.infer<typeof oauthAuthorizeRequest>;
export type OAuthAuthorizeResponse = z.infer<typeof oauthAuthorizeResponse>;

export type GraphqlRequest = z.infer<typeof graphqlRequest>;
export type GraphqlResponse = z.infer<typeof graphqlResponse>;

export type SubmitScoreRequest = z.infer<typeof submitScoreRequest>;
export type SubmitScoreResponse = z.infer<typeof submitScoreResponse>;
export type GetScoreRequest = z.infer<typeof getScoreRequest>;
export type GetScoreResponse = z.infer<typeof getScoreResponse>;
export type ResolveDidRequest = z.infer<typeof resolveDidRequest>;
export type ResolveDidResponse = z.infer<typeof resolveDidResponse>;

// ---------------------------------------------------------------------------
// Middleware / OpenAPI re-exports (single definition lives in ./middleware)
// ---------------------------------------------------------------------------

export {
  validateRequest,
  validateResponse,
  validationMiddleware,
  zodToOpenApi,
  generateOpenApiSpec,
} from './middleware';

export type {
  ValidationIssue,
  ValidationResult,
  OpenApiSchema,
} from './middleware';
