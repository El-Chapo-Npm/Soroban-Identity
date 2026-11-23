import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema, z } from 'zod';

/**
 * Schema definition patterns
 * --------------------------
 * - Define one Zod schema per endpoint request/response shape.
 * - Export inferred TypeScript types via `z.infer<typeof Schema>`.
 * - Attach a `version` to each schema so clients can negotiate the contract.
 * - Use the custom validators below for domain-specific fields.
 *
 * Example:
 *   export const SubmitScoreRequestV1 = withVersion(
 *     z.object({ address: stellarAddress(), score: z.number().int().min(0).max(100) }),
 *     '1',
 *   );
 *   export type SubmitScoreRequestV1 = z.infer<typeof SubmitScoreRequestV1>;
 */

/** Stellar public key (ed25519, StrKey encoded, starts with G). */
export const stellarAddress = () =>
  z.string().regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar address');

/** Decentralized identifier, e.g. did:stellar:G... or did:key:z... */
export const did = () =>
  z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/, 'Invalid DID format');

/** Attach a schema version for versioning support. */
export const withVersion = <T extends ZodSchema>(schema: T, version: string) =>
  schema.describe(`v${version}`);

/** Flatten a ZodError into field-path keyed messages. */
export const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

const isDev = () => process.env.NODE_ENV !== 'production';

/**
 * Validate an incoming request body against a Zod schema.
 * Rejects invalid payloads with HTTP 400 and field-path error details.
 */
export const validateRequest =
  <T extends ZodSchema>(schema: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: formatZodError(result.error),
      });
    }
    req.body = result.data;
    return next();
  };

/**
 * Validate an outgoing response against a Zod schema.
 * Only enforced in development to avoid breaking production traffic.
 */
export const validateResponse =
  <T extends ZodSchema>(schema: T) =>
  (_req: Request, res: Response, next: NextFunction) => {
    if (!isDev()) return next();
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const result = schema.safeParse(body);
      if (!result.success) {
        return originalJson({
          error: 'ResponseValidationError',
          details: formatZodError(result.error),
        });
      }
      return originalJson(result.data);
    };
    return next();
  };

/**
 * Minimal OpenAPI 3.0 document generator from Zod schemas.
 * Maps object shapes to JSON Schema properties for documentation.
 */
export const generateOpenApiSpec = (
  schemas: Record<string, ZodSchema>,
  info: { title: string; version: string } = { title: 'API', version: '1.0.0' },
) => {
  const components: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    components[name] = zodToJsonSchema(schema);
  }
  return {
    openapi: '3.0.0',
    info,
    paths: {},
    components: { schemas: components },
  };
};

const zodToJsonSchema = (schema: ZodSchema): Record<string, unknown> => {
  const def = (schema as unknown as { _def?: { typeName?: string; shape?: () => Record<string, ZodSchema> } })._def;
  if (def?.typeName === 'ZodObject' && typeof def.shape === 'function') {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      required.push(key);
    }
    return { type: 'object', properties, required };
  }
  if (def?.typeName === 'ZodString') return { type: 'string' };
  if (def?.typeName === 'ZodNumber') return { type: 'number' };
  if (def?.typeName === 'ZodBoolean') return { type: 'boolean' };
  return {};
};
