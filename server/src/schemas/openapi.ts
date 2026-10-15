import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SubmitScoreRequestSchema,
  SubmitScoreResponseSchema,
  GetReputationRequestSchema,
  GetReputationResponseSchema,
  ErrorResponseSchema,
  SCHEMA_VERSION,
} from './index';

/**
 * OpenAPI 3.0 specification generated from the Zod schemas.
 *
 * This keeps the published API contract in lock-step with the runtime
 * validation schemas: any change to a Zod schema is reflected here without
 * maintaining a hand-written spec.
 */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
}

const toSchema = (schema: z.ZodTypeAny, name: string): Record<string, unknown> =>
  zodToJsonSchema(schema, { name, target: 'openApi3' }) as Record<string, unknown>;

const jsonBody = (schema: z.ZodTypeAny, name: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${name}` },
    },
  },
});

const jsonResponse = (schema: z.ZodTypeAny, name: string, description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${name}` },
    },
  },
});

/**
 * Build the OpenAPI document from the Zod schemas.
 *
 * @param version API/schema version to advertise (schema versioning support).
 */
export function generateOpenApiSpec(version = SCHEMA_VERSION): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Reputation API',
      version,
      description: 'Runtime-validated API contract generated from Zod schemas.',
    },
    paths: {
      '/v1/reputation/submit-score': {
        post: {
          operationId: 'submitScoreV1',
          requestBody: jsonBody(SubmitScoreRequestSchema, 'SubmitScoreRequest'),
          responses: {
            '200': jsonResponse(SubmitScoreResponseSchema, 'SubmitScoreResponse', 'Score submitted'),
            '400': jsonResponse(ErrorResponseSchema, 'ErrorResponse', 'Validation error'),
          },
        },
      },
      '/v1/reputation/{address}': {
        get: {
          operationId: 'getReputationV1',
          parameters: [
            {
              name: 'address',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': jsonResponse(GetReputationResponseSchema, 'GetReputationResponse', 'Reputation record'),
            '400': jsonResponse(ErrorResponseSchema, 'ErrorResponse', 'Validation error'),
          },
        },
      },
      '/v2/reputation/submit-score': {
        post: {
          operationId: 'submitScoreV2',
          requestBody: jsonBody(SubmitScoreRequestSchema, 'SubmitScoreRequest'),
          responses: {
            '200': jsonResponse(SubmitScoreResponseSchema, 'SubmitScoreResponse', 'Score submitted'),
            '400': jsonResponse(ErrorResponseSchema, 'ErrorResponse', 'Validation error'),
          },
        },
      },
      '/v2/reputation/{address}': {
        get: {
          operationId: 'getReputationV2',
          parameters: [
            {
              name: 'address',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': jsonResponse(GetReputationResponseSchema, 'GetReputationResponse', 'Reputation record'),
            '400': jsonResponse(ErrorResponseSchema, 'ErrorResponse', 'Validation error'),
          },
        },
      },
    },
    components: {
      schemas: {
        SubmitScoreRequest: toSchema(SubmitScoreRequestSchema, 'SubmitScoreRequest'),
        SubmitScoreResponse: toSchema(SubmitScoreResponseSchema, 'SubmitScoreResponse'),
        GetReputationRequest: toSchema(GetReputationRequestSchema, 'GetReputationRequest'),
        GetReputationResponse: toSchema(GetReputationResponseSchema, 'GetReputationResponse'),
        ErrorResponse: toSchema(ErrorResponseSchema, 'ErrorResponse'),
      },
    },
  };
}
