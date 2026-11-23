import { z } from 'zod';

/**
 * Custom Zod validators shared across endpoint schemas.
 *
 * Schema definition patterns:
 * - Define request/response schemas with `z.object({...})`.
 * - Export inferred types via `z.infer<typeof Schema>` so runtime and
 *   compile-time contracts stay in sync automatically.
 * - Attach a `version` to each schema group for schema versioning support.
 * - Use the custom validators below for domain-specific formats.
 */

// Stellar public key: ed25519, base32, starts with 'G', 56 chars total.
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

// DID format: did:<method>:<identifier>
const DID_REGEX = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

export const stellarAddress = z
  .string()
  .regex(STELLAR_ADDRESS_REGEX, 'Invalid Stellar address');

export const did = z.string().regex(DID_REGEX, 'Invalid DID format');

/**
 * Schema versioning support. Every schema group declares a version so
 * clients and servers can negotiate compatible payload shapes.
 */
export const SCHEMA_VERSION = '1.0.0' as const;

export const schemaVersion = z.literal(SCHEMA_VERSION);

/**
 * Formats a ZodError into a list of messages that include field paths,
 * e.g. `body.address: Invalid Stellar address`.
 */
export function formatValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates a value against a schema and returns a discriminated result.
 * Used by the validation middleware to reject invalid requests with 400.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
):
  | { success: true; data: z.infer<T> }
  | { success: false; errors: string[] } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatValidationErrors(result.error) };
}
