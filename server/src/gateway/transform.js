import { validateRequest } from '../utils/validation.js';

/**
 * Gateway request transformation and validation middleware.
 *
 * Validates the incoming request (headers, query, params, body) against the
 * provided schemas using the shared validation utilities, and attaches the
 * normalized/validated data to `req.validated` for downstream consumers.
 *
 * @param {Object} [schemas] - Optional map of schemas keyed by request part.
 * @param {Object} [schemas.headers] - Schema for request headers.
 * @param {Object} [schemas.query] - Schema for query parameters.
 * @param {Object} [schemas.params] - Schema for route parameters.
 * @param {Object} [schemas.body] - Schema for the request body.
 * @returns {Function} Express middleware.
 */
export function transformRequest(schemas = {}) {
  return function gatewayTransform(req, res, next) {
    const validated = {};

    try {
      if (schemas.headers) {
        validated.headers = validateRequest(req.headers, schemas.headers, 'headers');
      }

      if (schemas.query) {
        validated.query = validateRequest(req.query, schemas.query, 'query');
      }

      if (schemas.params) {
        validated.params = validateRequest(req.params, schemas.params, 'params');
      }

      if (schemas.body) {
        validated.body = validateRequest(req.body, schemas.body, 'body');
      }
    } catch (err) {
      return next(err);
    }

    req.validated = validated;

    return next();
  };
}

/**
 * Convenience middleware that validates all request parts using the supplied
 * schemas object. Equivalent to `transformRequest(schemas)`.
 *
 * @param {Object} schemas - Map of schemas keyed by request part.
 * @returns {Function} Express middleware.
 */
export function validateGatewayRequest(schemas) {
  return transformRequest(schemas);
}

export default transformRequest;