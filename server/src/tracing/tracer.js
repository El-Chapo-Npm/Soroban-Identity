import crypto from 'node:crypto';
import { logger } from '../logger.js';
import { requestContextStore } from '../request-context.js';

export const TraceSpanKind = {
  INTERNAL: 'INTERNAL',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT',
  PRODUCER: 'PRODUCER',
  CONSUMER: 'CONSUMER',
};

/**
 * OpenTelemetry compatible Span representation
 */
export class Span {
  constructor(name, { parentSpanId = null, traceId = null, kind = TraceSpanKind.INTERNAL, attributes = {} } = {}) {
    this.name = name;
    this.traceId = traceId || crypto.randomBytes(16).toString('hex');
    this.spanId = crypto.randomBytes(8).toString('hex');
    this.parentSpanId = parentSpanId;
    this.kind = kind;
    this.startTime = Date.now();
    this.endTime = null;
    this.attributes = { ...attributes };
    this.events = [];
    this.status = { code: 'UNSET' };
  }

  setAttribute(key, value) {
    if (value !== undefined && value !== null) {
      this.attributes[key] = value;
    }
    return this;
  }

  setAttributes(attrs) {
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        this.setAttribute(k, v);
      }
    }
    return this;
  }

  addEvent(name, attributes = {}) {
    this.events.push({
      name,
      time: Date.now(),
      attributes,
    });
    return this;
  }

  setStatus(status) {
    this.status = status;
    return this;
  }

  recordException(err) {
    this.setStatus({ code: 'ERROR', message: err?.message });
    this.addEvent('exception', {
      'exception.type': err?.name || 'Error',
      'exception.message': err?.message,
      'exception.stacktrace': err?.stack,
    });
    return this;
  }

  end() {
    if (!this.endTime) {
      this.endTime = Date.now();
    }
  }
}

/**
 * OpenTelemetry Exporter supporting Jaeger and Zipkin HTTP collectors
 */
export class TraceExporter {
  constructor(options = {}) {
    this.endpoint = options.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
    this.exporterType = options.exporterType || (process.env.OTEL_EXPORTER_TYPE ?? 'jaeger'); // jaeger, zipkin, or console
    this.batch = [];
    this.maxBatchSize = options.maxBatchSize || 50;
    this.flushIntervalMs = options.flushIntervalMs || 2000;
    this._timer = null;

    if (this.exporterType !== 'console') {
      this._timer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      if (this._timer.unref) this._timer.unref();
    }
  }

  export(span) {
    this.batch.push(span);
    if (this.batch.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  async flush() {
    if (this.batch.length === 0) return;
    const spansToExport = [...this.batch];
    this.batch = [];

    if (this.exporterType === 'console') {
      for (const s of spansToExport) {
        logger.debug({ traceId: s.traceId, spanId: s.spanId, name: s.name, durationMs: s.endTime - s.startTime }, 'Exported Span');
      }
      return;
    }

    // Export to Jaeger or Zipkin endpoint
    try {
      if (this.exporterType === 'zipkin') {
        const zipkinSpans = spansToExport.map((s) => ({
          traceId: s.traceId,
          id: s.spanId,
          parentId: s.parentSpanId || undefined,
          name: s.name,
          timestamp: s.startTime * 1000,
          duration: ((s.endTime || Date.now()) - s.startTime) * 1000,
          tags: s.attributes,
        }));
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(zipkinSpans),
        }).catch(() => {});
      } else {
        // Jaeger / OTLP format
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: spansToExport }] }] }),
        }).catch(() => {});
      }
    } catch {
      // Best-effort export; never crash application
    }
  }

  shutdown() {
    if (this._timer) clearInterval(this._timer);
    return this.flush();
  }
}

/**
 * OpenTelemetry Node SDK Tracer Provider
 */
export class NodeTracer {
  constructor(options = {}) {
    this.serviceName = options.serviceName || process.env.OTEL_SERVICE_NAME || 'soroban-identity';
    // Configure sampling rate (default 10% / 0.10)
    const envRate = process.env.OTEL_SAMPLING_RATE;
    this.samplingRate = options.samplingRate ?? (envRate ? Number(envRate) : 0.1);
    this.exporter = options.exporter || new TraceExporter(options);
  }

  shouldSample() {
    return Math.random() < this.samplingRate;
  }

  startSpan(name, options = {}) {
    const parentContext = this.extractContext(options.parentContext);
    const traceId = parentContext?.traceId || crypto.randomBytes(16).toString('hex');
    const parentSpanId = parentContext?.spanId || null;

    const span = new Span(name, {
      traceId,
      parentSpanId,
      kind: options.kind || TraceSpanKind.INTERNAL,
      attributes: {
        'service.name': this.serviceName,
        ...options.attributes,
      },
    });

    const isSampled = options.forceSample || this.shouldSample();
    span._sampled = isSampled;
    return span;
  }

  endSpan(span) {
    span.end();
    if (span._sampled) {
      this.exporter.export(span);
    }
  }

  /**
   * Propagate trace context to headers / worker threads / cross-service calls
   */
  injectContext(span, carrier = {}) {
    if (!span) return carrier;
    carrier['traceparent'] = `00-${span.traceId}-${span.spanId}-${span._sampled ? '01' : '00'}`;
    carrier['x-trace-id'] = span.traceId;
    carrier['x-span-id'] = span.spanId;
    return carrier;
  }

  /**
   * Extract trace context from carrier / headers / worker message data
   */
  extractContext(carrier) {
    if (!carrier) return null;
    const traceparent = carrier.traceparent || carrier['traceparent'];
    if (traceparent && typeof traceparent === 'string') {
      const match = traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
      if (match) {
        return {
          traceId: match[1],
          spanId: match[2],
          sampled: match[3] === '01',
        };
      }
    }
    const traceId = carrier['x-trace-id'];
    const spanId = carrier['x-span-id'];
    if (traceId && spanId) {
      return { traceId, spanId, sampled: true };
    }
    return null;
  }
}

export const defaultTracer = new NodeTracer();
