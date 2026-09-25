import { z } from 'zod';

/**
 * Schema definition patterns
 * --------------------------
 * - Every endpoint has a request schema and a response schema.
 * - Types are inferred from schemas via `z.infer` so runtime validation and
 *   compile-time types never drift apart.
 * - Schemas are versioned: `SCHEMA_VERSION` is attached to every response
 *   envelope and can be used by clients to detect breaking changes.
 * - Custom validators (Stellar address, DID) live in this module and are
 *   reused across request/response schemas.
 */

export const SCHEMA_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Custom validators
// ---------------------------------------------------------------------------

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;

export const stellarAddress = z
  .string()
  .regex(STELLAR_ADDRESS_RE, 'Invalid Stellar address');

export const did = z
  .string()
  .regex(DID_RE, 'Invalid DID format');

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
export type SubmitScoreRequest = z.infer<typeof submitScoreRequest>;
export type SubmitScoreResponse = z.infer<typeof submitScoreResponse>;
export type GetScoreRequest = z.infer<typeof getScoreRequest>;
export type GetScoreResponse = z.infer<typeof getScoreResponse>;
export type ResolveDidRequest = z.infer<typeof resolveDidRequest>;
export type ResolveDidResponse = z.infer<typeof resolveDidResponse>;

// ---------------------------------------------------------------------------
// Validation middleware
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  issues?: ValidationIssue[];
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validate an incoming request body against a schema. Returns a 400-ready
 * result with field paths when validation fails.
 */
export function validateRequest<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, issues: toIssues(parsed.error) };
  }
  return { success: true, data: parsed.data };
}

/**
 * Validate an outgoing response. In development mode a failure throws so
 * contract drift is caught early; in production it is logged and passed
 * through to avoid breaking live traffic.
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  options: { development?: boolean } = {},
): ValidationResult<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = toIssues(parsed.error);
    if (options.development) {
      throw new Error(
        `Response validation failed: ${issues
          .map((i) => `${i.path}: ${i.message}`)
          .join(', ')}`,
      );
    }
    return { success: false, issues };
  }
  return { success: true, data: parsed.data };
}

/**
 * Express-style middleware factory. Rejects invalid requests with HTTP 400
 * and a structured error body including field paths.
 */
export function validationMiddleware<T>(schema: z.ZodType<T>) {
  return (req: { body: unknown }, res: any, next: (err?: unknown) => void) => {
    const result = validateRequest(schema, req.body);
    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          fields: result.issues,
        },
        schemaVersion: SCHEMA_VERSION,
      });
      return;
    }
    (req as { body: T }).body = result.data as T;
    next();
  };
}

// ---------------------------------------------------------------------------
// OpenAPI generation from Zod schemas
// ---------------------------------------------------------------------------

export interface OpenApiSchema {
  type: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
}

/**
 * Minimal Zod -> OpenAPI schema converter covering the primitives used by the
 * endpoint schemas above. Keeps the OpenAPI spec in sync with validation.
 */
export function zodToOpenApi(schema: z.ZodTypeAny): OpenApiSchema {
  const def = (schema as any)._def;
  const typeName: string = def?.typeName ?? '';

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber': {
      const out: OpenApiSchema = { type: 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minimum = check.value;
        if (check.kind === 'max') out.maximum = check.value;
      }
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToOpenApi(def.type) };
    case 'ZodOptional':
      return zodToOpenApi(def.innerType);
    case 'ZodDefault':
      return zodToOpenApi(def.innerType);
    case 'ZodObject': {
      const shape = def.shape();
      const properties: Record<string, OpenApiSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToOpenApi(value as z.ZodTypeAny);
        const inner = (value as any)._def?.typeName;
        if (inner !== 'ZodOptional' && inner !== 'ZodDefault') required.push(key);
      }
      return { type: 'object', properties, required };
    }
    default:
      return { type: 'object' };
  }
}

export function generateOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'Reputation API', version: SCHEMA_VERSION },
    paths: {
      '/reputation/score': {
        post: {
          requestBody: { content: { 'application/json': { schema: zodToOpenApi(submitScoreRequest) } } },
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: zodToOpenApi(submitScoreResponse) } } } },
        },
        get: {
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: zodToOpenApi(getScoreResponse) } } } },
        },
      },
      '/identity/did': {
        post: {
          requestBody: { content: { 'application/json': { schema: zodToOpenApi(resolveDidRequest) } } },
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: zodToOpenApi(resolveDidResponse) } } } },
        },
      },
    },
  };
}
