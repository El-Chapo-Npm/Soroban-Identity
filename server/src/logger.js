// Log sanitization: redacts secrets before anything reaches stdout/stderr.
// Rules are documented in server/LOGGING.md.

export const REDACTED = '[REDACTED]';

// Object keys whose values are always redacted (case-insensitive, substring match).
const SENSITIVE_KEYS = /(authorization|cookie|password|passphrase|secret|token|api[-_]?key|private[-_]?key|seed|mnemonic|signature)/i;

// Value patterns masked wherever they appear inside strings.
const VALUE_PATTERNS = [
  /\bS[A-Z2-7]{55}\b/g, // Stellar secret seeds
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // bearer tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM keys
];

export function sanitizeString(value) {
  return VALUE_PATTERNS.reduce((out, re) => out.replace(re, REDACTED), value);
}

export function sanitize(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message), stack: value.stack && sanitizeString(value.stack) };
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, seen));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.test(key) ? REDACTED : sanitize(v, seen);
  }
  return out;
}

export function sanitizeHeaders(headers = {}) {
  return sanitize({ ...headers });
}

// Middleware-style wrapper: logs a sanitized request/response line per request.
export function withRequestLogging(handler, log = logger) {
  return async function loggedHandler(req, res) {
    const start = Date.now();
    res.on?.('finish', () => {
      log.info({
        method: req.method,
        url: sanitizeString(req.url ?? ''),
        status: res.statusCode,
        latencyMs: Date.now() - start,
        durationMs: Date.now() - start,
        did: extractDid(req),
        headers: sanitizeHeaders(req.headers),
      });
    });
    return handler(req, res);
  };
}

import pino from 'pino';
import { requestContextStore } from './request-context.js';

export function getRequestLogFields(store = requestContextStore.getStore()) {
  if (!store) return {};
  return {
    ...(store.requestId || store.correlationId ? { requestId: store.requestId ?? store.correlationId } : {}),
    ...(store.correlationId ? { correlationId: store.correlationId } : {}),
    ...(store.traceId ? { traceId: store.traceId } : {}),
    ...(store.spanId ? { spanId: store.spanId } : {}),
    ...(store.did ? { did: store.did } : {}),
    ...(typeof store.latencyMs === 'number' ? { latencyMs: store.latencyMs } : {}),
  };
}

/**
 * Extract a DID from route params (e.g. /identity/:did) or a raw path.
 * Returns undefined when no DID is present.
 */
export function extractDid(req) {
  const fromParams = req?.params?.did;
  if (typeof fromParams === 'string' && fromParams) return fromParams;
  const path = req?.path ?? req?.url ?? '';
  const match = /\/identity\/([^/?#]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Build a request-scoped child logger carrying requestId, did and latencyMs.
 * Latency is computed from the supplied start time (defaults to now).
 */
export function createRequestLogger(req, { start = Date.now(), bindings = {} } = {}) {
  const requestId = req?.id ?? req?.requestId ?? req?.headers?.['x-request-id'];
  const did = extractDid(req);
  return logger.child({
    ...(requestId ? { requestId } : {}),
    ...(did ? { did } : {}),
    ...bindings,
  }).child({
    get latencyMs() {
      return Date.now() - start;
    },
  });
}

/**
 * Create a structured JSON logger using pino.
 * 
 * Log levels: trace, debug, info, warn, error, fatal
 * Default level: info
 * 
 * Controlled by LOG_LEVEL env var.
 */
function createLogger() {
  const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
  
  return pino({
    level,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined, // Remove default pid/hostname
    mixin() {
      // Inject requestId, correlationId (#946), did and latencyMs from the request context
      return getRequestLogFields();
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
        '*.privateKey',
      ],
      censor: REDACTED,
    },
  });
}

export const logger = createLogger();

/**
 * Create a child logger with additional context fields.
 * 
 * @param {object} bindings - Context fields to include in all logs
 * @returns {pino.Logger} Child logger instance
 */
export function createChildLogger(bindings) {
  return logger.child(bindings);
}
