import { defaultTracer, TraceSpanKind } from './tracer.js';
import { requestContextStore } from '../request-context.js';

/**
 * Middleware creating trace spans for HTTP requests and adding custom attributes
 * (tenant_id, http.method, http.target, status_code).
 */
export function openTelemetryHttpMiddleware(tracer = defaultTracer) {
  return function otelMiddleware(req, res, next) {
    const parentContext = tracer.extractContext(req.headers);
    const span = tracer.startSpan(`HTTP ${req.method} ${req.url.split('?')[0]}`, {
      parentContext,
      kind: TraceSpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.route': req.url.split('?')[0],
        'http.user_agent': req.headers['user-agent'] || '',
        'tenant_id': req.tenantId || req.headers['x-tenant-id'] || 'default',
      },
    });

    // Inject traceparent in response headers for client visibility
    tracer.injectContext(span, res);
    res.setHeader('X-Trace-Id', span.traceId);

    // Bind span in request context
    const currentStore = requestContextStore.getStore() || {};
    requestContextStore.enterWith({
      ...currentStore,
      span,
      tracer,
    });

    const originalEnd = res.end;
    res.end = function (...args) {
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: 'ERROR', message: `HTTP ${res.statusCode}` });
      } else {
        span.setStatus({ code: 'OK' });
      }
      tracer.endSpan(span);
      return originalEnd.apply(this, args);
    };

    if (typeof next === 'function') next();
  };
}

/**
 * Trace a Soroban contract invocation with custom attributes (contract_name, contract_id, method, tenant_id)
 */
export async function traceContractCall(contractName, method, args, invokeFn, tracer = defaultTracer) {
  const currentStore = requestContextStore.getStore() || {};
  const parentSpan = currentStore.span;
  const tenant_id = currentStore.tenantId || 'default';

  const span = tracer.startSpan(`soroban.${contractName}.${method}`, {
    parentContext: parentSpan ? { traceId: parentSpan.traceId, spanId: parentSpan.spanId } : null,
    kind: TraceSpanKind.CLIENT,
    attributes: {
      'rpc.system': 'soroban',
      'contract_name': contractName,
      'contract_id': args?.contractId || contractName,
      'rpc.method': method,
      'tenant_id': tenant_id,
    },
  });

  try {
    const result = await invokeFn();
    span.setStatus({ code: 'OK' });
    return result;
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    tracer.endSpan(span);
  }
}

/**
 * Trace cross-service calls (Redis, external webhooks)
 */
export async function traceExternalCall(serviceType, operation, fn, tracer = defaultTracer) {
  const currentStore = requestContextStore.getStore() || {};
  const parentSpan = currentStore.span;
  const tenant_id = currentStore.tenantId || 'default';

  const span = tracer.startSpan(`${serviceType}.${operation}`, {
    parentContext: parentSpan ? { traceId: parentSpan.traceId, spanId: parentSpan.spanId } : null,
    kind: TraceSpanKind.CLIENT,
    attributes: {
      'peer.service': serviceType,
      'db.operation': operation,
      'tenant_id': tenant_id,
    },
  });

  try {
    const res = await fn(span);
    span.setStatus({ code: 'OK' });
    return res;
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    tracer.endSpan(span);
  }
}

/**
 * Propagate trace context to a worker thread payload
 */
export function createWorkerTraceContext(tracer = defaultTracer) {
  const currentStore = requestContextStore.getStore() || {};
  const parentSpan = currentStore.span;
  if (!parentSpan) return {};
  const carrier = {};
  tracer.injectContext(parentSpan, carrier);
  return {
    ...carrier,
    tenant_id: currentStore.tenantId || 'default',
  };
}
