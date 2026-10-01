import { GraphQLError } from 'graphql';
import { randomUUID } from 'crypto';

/**
 * GraphQL write operations for DIDs and verifiable credentials.
 *
 * These resolvers complement the read-only query surface with mutations for
 * creating/updating DIDs and issuing/revoking credentials. Input validation is
 * performed up-front and failures are surfaced as typed GraphQLError codes so
 * clients can branch on `extensions.code`.
 */

export interface DIDRecord {
  id: string;
  method: string;
  controller: string;
  publicKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRecord {
  id: string;
  subject: string;
  issuer: string;
  type: string;
  claims: Record<string, unknown>;
  status: 'active' | 'revoked';
  issuedAt: string;
  revokedAt?: string;
  revocationReason?: string;
}

export interface CreateDIDInput {
  method: string;
  controller: string;
  publicKey: string;
}

export interface IssueCredentialInput {
  subject: string;
  issuer: string;
  type: string;
  claims?: Record<string, unknown>;
}

export interface RevokeCredentialInput {
  id: string;
  reason?: string;
}

export interface MutationContext {
  dids: Map<string, DIDRecord>;
  credentials: Map<string, CredentialRecord>;
}

const SUPPORTED_DID_METHODS = ['key', 'web', 'ethr'];

function invalidInput(message: string, field?: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'BAD_USER_INPUT', field },
  });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'NOT_FOUND' },
  });
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidInput(`Field "${field}" is required and must be a non-empty string.`, field);
  }
  return value.trim();
}

function validateClaims(claims: unknown): Record<string, unknown> {
  if (claims === undefined || claims === null) {
    return {};
  }
  if (typeof claims !== 'object' || Array.isArray(claims)) {
    throw invalidInput('Field "claims" must be an object.', 'claims');
  }
  return claims as Record<string, unknown>;
}

/**
 * createDID(input: CreateDIDInput!): DID!
 */
export function createDID(
  _parent: unknown,
  args: { input: CreateDIDInput },
  ctx: MutationContext,
): DIDRecord {
  const input = args?.input;
  if (!input || typeof input !== 'object') {
    throw invalidInput('Mutation "createDID" requires an input object.', 'input');
  }

  const method = requireNonEmpty(input.method, 'method');
  if (!SUPPORTED_DID_METHODS.includes(method)) {
    throw invalidInput(
      `Unsupported DID method "${method}". Supported methods: ${SUPPORTED_DID_METHODS.join(', ')}.`,
      'method',
    );
  }

  const controller = requireNonEmpty(input.controller, 'controller');
  const publicKey = requireNonEmpty(input.publicKey, 'publicKey');

  const now = new Date().toISOString();
  const record: DIDRecord = {
    id: `did:${method}:${randomUUID()}`,
    method,
    controller,
    publicKey,
    createdAt: now,
    updatedAt: now,
  };

  ctx.dids.set(record.id, record);
  return record;
}

/**
 * issueCredential(input: IssueCredentialInput!): Credential!
 */
export function issueCredential(
  _parent: unknown,
  args: { input: IssueCredentialInput },
  ctx: MutationContext,
): CredentialRecord {
  const input = args?.input;
  if (!input || typeof input !== 'object') {
    throw invalidInput('Mutation "issueCredential" requires an input object.', 'input');
  }

  const subject = requireNonEmpty(input.subject, 'subject');
  const issuer = requireNonEmpty(input.issuer, 'issuer');
  const type = requireNonEmpty(input.type, 'type');
  const claims = validateClaims(input.claims);

  if (!ctx.dids.has(issuer)) {
    throw notFound(`Issuer DID "${issuer}" does not exist.`);
  }

  const record: CredentialRecord = {
    id: `vc:${randomUUID()}`,
    subject,
    issuer,
    type,
    claims,
    status: 'active',
    issuedAt: new Date().toISOString(),
  };

  ctx.credentials.set(record.id, record);
  return record;
}

/**
 * revokeCredential(input: RevokeCredentialInput!): Credential!
 */
export function revokeCredential(
  _parent: unknown,
  args: { input: RevokeCredentialInput },
  ctx: MutationContext,
): CredentialRecord {
  const input = args?.input;
  if (!input || typeof input !== 'object') {
    throw invalidInput('Mutation "revokeCredential" requires an input object.', 'input');
  }

  const id = requireNonEmpty(input.id, 'id');
  const record = ctx.credentials.get(id);
  if (!record) {
    throw notFound(`Credential "${id}" does not exist.`);
  }
  if (record.status === 'revoked') {
    throw invalidInput(`Credential "${id}" is already revoked.`, 'id');
  }

  const reason = input.reason === undefined ? undefined : requireNonEmpty(input.reason, 'reason');

  const updated: CredentialRecord = {
    ...record,
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revocationReason: reason,
  };

  ctx.credentials.set(id, updated);
  return updated;
}

/**
 * GraphQL SDL for the write surface. Merge into the root Mutation type.
 *
 * type Mutation {
 *   createDID(input: CreateDIDInput!): DID!
 *   issueCredential(input: IssueCredentialInput!): Credential!
 *   revokeCredential(input: RevokeCredentialInput!): Credential!
 * }
 *
 * input CreateDIDInput { method: String!, controller: String!, publicKey: String! }
 * input IssueCredentialInput { subject: String!, issuer: String!, type: String!, claims: JSON }
 * input RevokeCredentialInput { id: ID!, reason: String }
 */
export const mutationTypeDefs = /* GraphQL */ `
  input CreateDIDInput {
    method: String!
    controller: String!
    publicKey: String!
  }

  input IssueCredentialInput {
    subject: String!
    issuer: String!
    type: String!
    claims: JSON
  }

  input RevokeCredentialInput {
    id: ID!
    reason: String
  }

  type Mutation {
    createDID(input: CreateDIDInput!): DID!
    issueCredential(input: IssueCredentialInput!): Credential!
    revokeCredential(input: RevokeCredentialInput!): Credential!
  }
`;

export const mutations = {
  createDID,
  issueCredential,
  revokeCredential,
};

export default mutations;
