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

function write(stream, level, args) {
  console[stream](...args.map((a) => sanitize(a)));
}

export const logger = {
  info: (...args) => write('log', 'info', args),
  warn: (...args) => write('warn', 'warn', args),
  error: (...args) => write('error', 'error', args),
};

// Middleware-style wrapper: logs a sanitized request/response line per request.
export function withRequestLogging(handler, log = logger) {
  return async function loggedHandler(req, res) {
    const start = Date.now();
    res.on?.('finish', () => {
      log.info({
        method: req.method,
        url: sanitizeString(req.url ?? ''),
        status: res.statusCode,
        durationMs: Date.now() - start,
        headers: sanitizeHeaders(req.headers),
      });
    });
    return handler(req, res);
  };
import pino from 'pino';
import { requestContextStore } from './request-context.js';

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
      // Inject requestId and correlationId (#946) from the request context
      const store = requestContextStore.getStore();
      if (store && (store.requestId || store.traceId)) {
        return {
          ...(store.requestId ? { requestId: store.requestId } : {}),
          ...(store.traceId ? { traceId: store.traceId } : {}),
          ...(store.spanId ? { spanId: store.spanId } : {}),
        };
      }
      return {};
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
