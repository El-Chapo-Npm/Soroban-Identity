import { initTracer } from 'jaeger-client';
import { logger } from './logger.js';

/**
 * Initialize Jaeger tracing with configuration from environment variables.
 * 
 * Environment variables:
 * - JAEGER_ENABLED: Enable/disable tracing (default: false)
 * - JAEGER_SERVICE_NAME: Service name for traces (default: soroban-identity-server)
 * - JAEGER_AGENT_HOST: Jaeger agent host (default: localhost)
 * - JAEGER_AGENT_PORT: Jaeger agent port (default: 6832)
 * - JAEGER_SAMPLER_TYPE: Sampler type (const, probabilistic, ratelimiting, remote) (default: const)
 * - JAEGER_SAMPLER_PARAM: Sampler parameter (default: 1 for const = all traces)
 * - JAEGER_REPORTER_LOG_SPANS: Log spans to console (default: false)
 * - JAEGER_REPORTER_FLUSH_INTERVAL: Flush interval in ms (default: 1000)
 * 
 * @param {object} config - Server configuration
 * @returns {object} Tracer instance or noop tracer if disabled
 */
export function createTracer(config) {
  const enabled = config.jaegerEnabled ?? false;
  
  if (!enabled) {
    logger.info('Distributed tracing is disabled');
    return createNoopTracer();
  }

  const serviceName = config.jaegerServiceName || 'soroban-identity-server';
  const agentHost = config.jaegerAgentHost || 'localhost';
  const agentPort = config.jaegerAgentPort || 6832;
  const samplerType = config.jaegerSamplerType || 'const';
  const samplerParam = config.jaegerSamplerParam ?? 1;
  const logSpans = config.jaegerReporterLogSpans ?? false;
  const flushIntervalMs = config.jaegerReporterFlushInterval ?? 1000;

  const tracerConfig = {
    serviceName,
    sampler: {
      type: samplerType,
      param: samplerParam,
    },
    reporter: {
      logSpans,
      agentHost,
      agentPort,
      flushIntervalMs,
    },
  };

  const options = {
    logger: {
      info: (msg) => logger.info({ component: 'jaeger' }, msg),
      error: (msg) => logger.error({ component: 'jaeger' }, msg),
    },
  };

  try {
    const tracer = initTracer(tracerConfig, options);
    logger.info({
      serviceName,
      agentHost,
      agentPort,
      samplerType,
      samplerParam,
    }, 'Distributed tracing initialized');
    
    return tracer;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Jaeger tracer, using noop tracer');
    return createNoopTracer();
  }
}

/**
 * Create a no-op tracer that implements the OpenTracing interface but does nothing.
 * Used when tracing is disabled or initialization fails.
 */
function createNoopTracer() {
  const noopSpan = {
    context: () => ({}),
    setTag: () => noopSpan,
    addTags: () => noopSpan,
    log: () => noopSpan,
    logEvent: () => noopSpan,
    setBaggageItem: () => noopSpan,
    getBaggageItem: () => null,
    setOperationName: () => noopSpan,
    finish: () => {},
  };

  return {
    startSpan: () => noopSpan,
    inject: () => {},
    extract: () => null,
    close: (callback) => {
      if (callback) callback();
    },
  };
}

/**
 * Create a child span from a parent span.
 * 
 * @param {object} tracer - Tracer instance
 * @param {string} operationName - Name of the operation
 * @param {object} parentSpan - Parent span
 * @param {object} tags - Additional tags for the span
 * @returns {object} Child span
 */
export function createChildSpan(tracer, operationName, parentSpan, tags = {}) {
  if (!tracer || !parentSpan) {
    return tracer.startSpan(operationName, { tags });
  }

  return tracer.startSpan(operationName, {
    childOf: parentSpan.context(),
    tags,
  });
}

/**
 * Extract trace context from HTTP headers.
 * 
 * @param {object} tracer - Tracer instance
 * @param {object} headers - HTTP request headers
 * @returns {object|null} Span context or null
 */
export function extractTraceContext(tracer, headers) {
  if (!tracer) return null;

  try {
    const FORMAT_HTTP_HEADERS = tracer.constructor.FORMAT_HTTP_HEADERS || 'http_headers';
    return tracer.extract(FORMAT_HTTP_HEADERS, headers);
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to extract trace context from headers');
    return null;
  }
}

/**
 * Inject trace context into HTTP headers for propagation.
 * 
 * @param {object} tracer - Tracer instance
 * @param {object} span - Current span
 * @param {object} headers - Headers object to inject into
 */
export function injectTraceContext(tracer, span, headers) {
  if (!tracer || !span) return;

  try {
    const FORMAT_HTTP_HEADERS = tracer.constructor.FORMAT_HTTP_HEADERS || 'http_headers';
    tracer.inject(span.context(), FORMAT_HTTP_HEADERS, headers);
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to inject trace context into headers');
  }
}

/**
 * Wrap an async function with automatic span creation and error handling.
 * 
 * @param {object} tracer - Tracer instance
 * @param {string} operationName - Name of the operation
 * @param {Function} fn - Async function to wrap
 * @param {object} options - Options
 * @param {object} options.parentSpan - Parent span
 * @param {object} options.tags - Additional tags
 * @returns {Function} Wrapped function
 */
export function traceAsync(tracer, operationName, fn, options = {}) {
  return async (...args) => {
    const span = tracer.startSpan(operationName, {
      childOf: options.parentSpan?.context(),
      tags: options.tags || {},
    });

    try {
      const result = await fn(...args);
      span.setTag('success', true);
      return result;
    } catch (error) {
      span.setTag('error', true);
      span.setTag('error.message', error.message);
      span.log({
        event: 'error',
        'error.kind': error.name,
        'error.object': error,
        message: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      span.finish();
    }
  };
}

/**
 * Standard tags for spans
 */
export const Tags = {
  // Span kind
  SPAN_KIND: 'span.kind',
  SPAN_KIND_RPC_CLIENT: 'client',
  SPAN_KIND_RPC_SERVER: 'server',
  
  // Component
  COMPONENT: 'component',
  
  // HTTP
  HTTP_METHOD: 'http.method',
  HTTP_URL: 'http.url',
  HTTP_STATUS_CODE: 'http.status_code',
  HTTP_PATH: 'http.path',
  
  // RPC
  RPC_SYSTEM: 'rpc.system',
  RPC_SERVICE: 'rpc.service',
  RPC_METHOD: 'rpc.method',
  
  // Database
  DB_TYPE: 'db.type',
  DB_INSTANCE: 'db.instance',
  DB_STATEMENT: 'db.statement',
  
  // Error
  ERROR: 'error',
  ERROR_KIND: 'error.kind',
  ERROR_MESSAGE: 'error.message',
  
  // Custom
  CREDENTIAL_ID: 'credential.id',
  DID: 'did',
  CONTRACT_ID: 'contract.id',
  NETWORK: 'network',
};

/**
 * Log levels for span logs
 */
export const LogLevel = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
};
