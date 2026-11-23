import { extractTraceContext, Tags } from './tracer.js';
import { requestContextStore } from './request-context.js';
import { logger } from './logger.js';

/**
 * Express-style middleware that creates a span for each incoming HTTP request.
 * 
 * Extracts trace context from incoming headers, creates a new span, and stores
 * it in AsyncLocalStorage for child spans to reference.
 * 
 * @param {object} tracer - Jaeger tracer instance
 * @returns {Function} Middleware function
 */
export function tracingMiddleware(tracer) {
  return (req, res, next) => {
    // Extract parent context from incoming headers (if present)
    const parentContext = extractTraceContext(tracer, req.headers);
    
    // Create span for this request
    const span = tracer.startSpan('http_request', {
      childOf: parentContext,
      tags: {
        [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_SERVER,
        [Tags.HTTP_METHOD]: req.method,
        [Tags.HTTP_URL]: req.url,
        [Tags.HTTP_PATH]: req.path || req.url.split('?')[0],
        [Tags.COMPONENT]: 'http-server',
      },
    });

    // Store span in AsyncLocalStorage for child operations
    const store = requestContextStore.getStore() || {};
    requestContextStore.enterWith({
      ...store,
      span,
      tracer,
    });

    // Capture response status code when finished
    const originalEnd = res.end;
    res.end = function (...args) {
      span.setTag(Tags.HTTP_STATUS_CODE, res.statusCode);
      
      // Mark span as error if status code is 5xx
      if (res.statusCode >= 500) {
        span.setTag(Tags.ERROR, true);
      }
      
      span.finish();
      return originalEnd.apply(this, args);
    };

    // Handle errors
    res.on('error', (error) => {
      span.setTag(Tags.ERROR, true);
      span.setTag(Tags.ERROR_MESSAGE, error.message);
      span.log({
        event: 'error',
        'error.kind': error.name,
        message: error.message,
        stack: error.stack,
      });
    });

    next();
  };
}

/**
 * Get the current span from AsyncLocalStorage.
 * 
 * @returns {object|null} Current span or null
 */
export function getCurrentSpan() {
  const store = requestContextStore.getStore();
  return store?.span || null;
}

/**
 * Get the current tracer from AsyncLocalStorage.
 * 
 * @returns {object|null} Current tracer or null
 */
export function getCurrentTracer() {
  const store = requestContextStore.getStore();
  return store?.tracer || null;
}

/**
 * Create a child span within the current request context.
 * 
 * @param {string} operationName - Name of the operation
 * @param {object} tags - Additional tags for the span
 * @returns {object} Child span
 */
export function startSpan(operationName, tags = {}) {
  const tracer = getCurrentTracer();
  const parentSpan = getCurrentSpan();
  
  if (!tracer) {
    // Return a noop span if no tracer available
    return {
      setTag: () => {},
      addTags: () => {},
      log: () => {},
      finish: () => {},
    };
  }

  return tracer.startSpan(operationName, {
    childOf: parentSpan?.context(),
    tags,
  });
}

/**
 * Wrap an async function with automatic span creation and cleanup.
 * 
 * @param {string} operationName - Name of the operation
 * @param {Function} fn - Async function to execute
 * @param {object} tags - Additional tags for the span
 * @returns {*} Result of the function
 */
export async function traceOperation(operationName, fn, tags = {}) {
  const span = startSpan(operationName, tags);
  
  try {
    const result = await fn(span);
    span.setTag('success', true);
    return result;
  } catch (error) {
    span.setTag(Tags.ERROR, true);
    span.setTag(Tags.ERROR_MESSAGE, error.message);
    span.log({
      event: 'error',
      'error.kind': error.name,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    span.finish();
  }
}

/**
 * Add tags to the current span.
 * 
 * @param {object} tags - Tags to add
 */
export function addTagsToCurrentSpan(tags) {
  const span = getCurrentSpan();
  if (span && typeof span.addTags === 'function') {
    span.addTags(tags);
  }
}

/**
 * Log an event to the current span.
 * 
 * @param {string} event - Event name
 * @param {object} fields - Additional fields
 */
export function logToCurrentSpan(event, fields = {}) {
  const span = getCurrentSpan();
  if (span && typeof span.log === 'function') {
    span.log({
      event,
      ...fields,
    });
  }
}
