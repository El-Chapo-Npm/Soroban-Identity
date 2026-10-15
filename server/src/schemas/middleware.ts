import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { formatZodError } from './validators';
import { schemaVersion } from './index';

/**
 * Schema definition patterns
 * --------------------------
 * - Define one Zod schema per endpoint request/response shape.
 * - Export inferred TypeScript types via `z.infer<typeof Schema>`.
 * - Attach a `version` to each schema so clients can negotiate the contract.
 * - Use the custom validators from `./validators` for domain-specific fields.
 *
 * Example:
 *   export const SubmitScoreRequestV1 = withVersion(
 *     z.object({ address: stellarAddress(), score: z.number().int().min(0).max(100) }),
 *     '1',
 *   );
 *   export type SubmitScoreRequestV1 = z.infer<typeof SubmitScoreRequestV1>;
 */

export type RequestSource = 'body' | 'query' | 'params' | 'headers';

const isDev = () => process.env.NODE_ENV !== 'production';

/**
 * Validate a single incoming request property against a Zod schema.
 * Rejects invalid payloads with HTTP 400 and field-path error details,
 * replacing the request property with the parsed value on success.
 */
export const validateRequest =
  <T extends ZodSchema>(schema: T, source: RequestSource = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          fields: formatZodError(result.error),
        },
        schemaVersion,
      });
    }
    req[source] = result.data;
    return next();
  };

/**
 * Validate an outgoing response against a Zod schema.
 * Only enforced outside production to avoid breaking production traffic.
 */
export const validateResponse =
  <T extends ZodSchema>(schema: T) =>
  (_req: Request, res: Response, next: NextFunction) => {
    if (!isDev()) return next();
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const result = schema.safeParse(body);
      if (!result.success) {
        // eslint-disable-next-line no-console
        console.error('Response validation failed', formatZodError(result.error));
        return originalJson(body);
      }
      return originalJson(result.data);
    };
    return next();
  };

/**
 * Convenience middleware that validates multiple request sources in one pass.
 */
export const validateAll = (schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) => {
  const middlewares = (Object.entries(schemas) as [RequestSource, ZodSchema][])
    .filter(([, schema]) => Boolean(schema))
    .map(([source, schema]) => validateRequest(schema, source));

  return (req: Request, res: Response, next: NextFunction) => {
    let index = 0;
    const run = (err?: unknown): void => {
      if (err) return next(err);
      const middleware = middlewares[index++];
      if (!middleware) return next();
      middleware(req, res, run);
    };
    run();
  };
};
