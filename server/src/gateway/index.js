import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createLogger } from '../middleware/logger.js';
import { createCircuitBreaker } from '../middleware/circuitBreaker.js';
import { createValidator } from '../middleware/validation.js';
import { createApiKeyManager } from '../middleware/apiKey.js';
import { createPluginRegistry } from '../plugins/registry.js';
import { createMetrics } from '../middleware/metrics.js';

/**
 * Composes an ordered list of middleware functions into a single pipeline.
 * Each middleware is expected to have the signature (req, res, next).
 * The pipeline short-circuits as soon as a middleware does not call next().
 *
 * @param {Array<Function>} middlewares
 * @returns {Function} composed middleware (req, res, next)
 */
export function composePipeline(middlewares) {
  if (!Array.isArray(middlewares)) {
    throw new TypeError('composePipeline expects an array of middleware functions');
  }

  for (const mw of middlewares) {
    if (typeof mw !== 'function') {
      throw new TypeError('All pipeline entries must be functions');
    }
  }

  return function pipeline(req, res, next) {
    let index = -1;

    function dispatch(i) {
      if (i <= index) {
        return next(new Error('next() called multiple times in gateway pipeline'));
      }
      index = i;

      const fn = middlewares[i];
      if (!fn) {
        return next();
      }

      try {
        return fn(req, res, (err) => {
          if (err) {
            return next(err);
          }
          return dispatch(i + 1);
        });
      } catch (err) {
        return next(err);
      }
    }

    return dispatch(0);
  };
}

/**
 * Creates a gateway instance that wires together all cross-cutting concerns
 * into a single composable middleware pipeline.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Application configuration object.
 * @param {object} [options.logger] - Base logger instance.
 * @param {object} [options.metrics] - Metrics collector instance.
 * @param {object} [options.plugins] - Plugin definitions to register.
 * @param {object} [options.auth] - Auth middleware options.
 * @param {object} [options.rateLimit] - Rate limiting options.
 * @param {object} [options.circuitBreaker] - Circuit breaker options.
 * @param {object} [options.validation] - Validation options.
 * @param {object} [options.apiKey] - API key management options.
 * @returns {{ pipeline: Function, middleware: Array<Function>, components: object }}
 */
export function createGateway(options = {}) {
  const {
    config = {},
    logger: baseLogger,
    metrics: metricsCollector,
    plugins = [],
    auth: authOptions = {},
    rateLimit: rateLimitOptions = {},
    circuitBreaker: circuitBreakerOptions = {},
    validation: validationOptions = {},
    apiKey: apiKeyOptions = {},
  } = options;

  const logger = createLogger({
    ...config.logging,
    ...(baseLogger ? { base: baseLogger } : {}),
  });

  const metrics = createMetrics({
    ...config.metrics,
    ...(metricsCollector ? { collector: metricsCollector } : {}),
  });

  const apiKeyManager = createApiKeyManager({
    ...config.apiKey,
    ...apiKeyOptions,
  });

  const pluginRegistry = createPluginRegistry({
    ...config.plugins,
    logger,
    metrics,
  });

  for (const plugin of plugins) {
    pluginRegistry.register(plugin);
  }

  const auth = createAuthMiddleware({
    ...config.auth,
    ...authOptions,
    apiKeyManager,
    logger,
  });

  const rateLimiter = createRateLimiter({
    ...config.rateLimit,
    ...rateLimitOptions,
    logger,
    metrics,
  });

  const requestLogger = createLogger({
    ...config.logging,
    ...(baseLogger ? { base: baseLogger } : {}),
    requestScoped: true,
  });

  const circuitBreaker = createCircuitBreaker({
    ...config.circuitBreaker,
    ...circuitBreakerOptions,
    logger,
    metrics,
  });

  const validator = createValidator({
    ...config.validation,
    ...validationOptions,
    logger,
  });

  const middleware = [
    requestLogger,
    metrics.middleware,
    apiKeyManager.middleware,
    auth,
    rateLimiter,
    circuitBreaker,
    validator,
    pluginRegistry.middleware,
  ];

  const pipeline = composePipeline(middleware);

  return {
    pipeline,
    middleware,
    components: {
      logger,
      metrics,
      apiKeyManager,
      pluginRegistry,
      auth,
      rateLimiter,
      circuitBreaker,
      validator,
    },
  };
}

export default createGateway;