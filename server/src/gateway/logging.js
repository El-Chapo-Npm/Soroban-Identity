import { randomUUID } from 'crypto';
import { getContext, runWithContext } from '../utils/request-context.js';
import logger from '../utils/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function getHeader(req, name) {
  if (!req || !req.headers) return undefined;
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function setHeader(res, name, value) {
  if (!res || typeof res.setHeader !== 'function') return;
  if (res.headersSent) return;
  res.setHeader(name, value);
}

export function gatewayLogging(req, res, next) {
  const incomingRequestId = getHeader(req, REQUEST_ID_HEADER);
  const incomingCorrelationId = getHeader(req, CORRELATION_ID_HEADER);

  const requestId = incomingRequestId || randomUUID();
  const correlationId = incomingCorrelationId || requestId;

  setHeader(res, 'X-Request-ID', requestId);
  setHeader(res, 'X-Correlation-ID', correlationId);

  const startTime = process.hrtime.bigint();
  const startMs = Date.now();

  const baseContext = {
    requestId,
    correlationId,
    method: req && req.method,
    path: (req && (req.originalUrl || req.url)) || undefined,
  };

  const existingContext = getContext() || {};
  const context = { ...existingContext, ...baseContext };

  const finish = () => {
    const durationNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(durationNs) / 1e6;

    const currentContext = getContext() || context;
    const status = res && typeof res.statusCode === 'number' ? res.statusCode : undefined;

    const logFields = {
      requestId: currentContext.requestId || requestId,
      correlationId: currentContext.correlationId || correlationId,
      method: currentContext.method || baseContext.method,
      path: currentContext.path || baseContext.path,
      status,
      duration: durationMs,
      durationMs,
      tenantId: currentContext.tenantId,
      apiKeyId: currentContext.apiKeyId,
    };

    const message = `${logFields.method || 'UNKNOWN'} ${logFields.path || ''} ${status ?? ''}`.trim();

    if (status !== undefined && status >= 500) {
      logger.error(message, logFields);
    } else if (status !== undefined && status >= 400) {
      logger.warn(message, logFields);
    } else {
      logger.info(message, logFields);
    }
  };

  if (res && typeof res.on === 'function') {
    res.on('finish', finish);
    res.on('close', finish);
  }

  runWithContext(context, () => {
    if (typeof next === 'function') {
      next();
    }
  });
}

export default gatewayLogging;
export { REQUEST_ID_HEADER, CORRELATION_ID_HEADER };