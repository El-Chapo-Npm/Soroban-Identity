'use strict';

const {
  NonceStore,
  RedisNonceStore,
} = require('../request-signing.js');

/**
 * Create a nonce store.
 *
 * When a Redis client is supplied a RedisNonceStore is returned so nonces are
 * shared across processes; otherwise an in-memory NonceStore is used.
 *
 * @param {object} [redisClient] Optional Redis client.
 * @param {object} [options] Options forwarded to the store constructor.
 * @returns {NonceStore|RedisNonceStore}
 */
function createNonceStore(redisClient, options = {}) {
  if (redisClient) {
    return new RedisNonceStore(redisClient, options);
  }
  return new NonceStore(options);
}

/**
 * Extract a header value from a request, tolerating both Express-style
 * (lowercased) and plain Node-style header objects.
 *
 * @param {object} req
 * @param {string} name
 * @returns {string|undefined}
 */
function getHeader(req, name) {
  if (!req || !req.headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  const headers = req.headers;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }
  return headers[lower] !== undefined ? headers[lower] : headers[name];
}

/**
 * Build the verdict object expected by app.js from checkNonce.
 *
 * @param {boolean} ok
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {string} [serverNonce]
 * @returns {{ok: boolean, status: number, code: string, message: string, serverNonce: (string|undefined)}}
 */
function verdict(ok, status, code, message, serverNonce) {
  return { ok, status, code, message, serverNonce };
}

/**
 * Express middleware that consumes the request nonce.
 *
 * Reads the nonce headers, calls store.consume, and returns a verdict matching
 * the shape app.js expects from checkNonce. On success the verdict is attached
 * to req.nonceVerdict and next() is called; on failure the middleware responds
 * with the appropriate status code.
 *
 * @param {NonceStore|RedisNonceStore} store
 * @returns {Function} Express middleware.
 */
function nonceMiddleware(store) {
  if (!store || typeof store.consume !== 'function') {
    throw new TypeError('nonceMiddleware requires a nonce store with a consume method');
  }

  return async function nonceHandler(req, res, next) {
    try {
      const nonce = getHeader(req, 'x-request-nonce') || getHeader(req, 'x-nonce');
      const timestamp = getHeader(req, 'x-request-timestamp') || getHeader(req, 'x-timestamp');
      const clientId = getHeader(req, 'x-client-id') || getHeader(req, 'x-tenant-id');

      if (!nonce) {
        const result = verdict(false, 400, 'MISSING_NONCE', 'Request nonce is required');
        req.nonceVerdict = result;
        if (typeof res.status === 'function') {
          return res.status(result.status).json({
            error: result.code,
            message: result.message,
          });
        }
        return next(result);
      }

      const consumeResult = await store.consume(nonce, {
        timestamp,
        clientId,
        req,
      });

      // Normalise the store result into the verdict shape app.js expects.
      let result;
      if (consumeResult === true || consumeResult === undefined) {
        result = verdict(true, 200, 'OK', 'Nonce accepted');
      } else if (consumeResult === false) {
        result = verdict(false, 409, 'NONCE_REPLAY', 'Nonce has already been used');
      } else if (consumeResult && typeof consumeResult === 'object') {
        const ok = consumeResult.ok !== undefined
          ? Boolean(consumeResult.ok)
          : Boolean(consumeResult.valid);
        result = verdict(
          ok,
          consumeResult.status || (ok ? 200 : 409),
          consumeResult.code || (ok ? 'OK' : 'NONCE_REPLAY'),
          consumeResult.message || (ok ? 'Nonce accepted' : 'Nonce rejected'),
          consumeResult.serverNonce,
        );
      } else {
        result = verdict(false, 400, 'INVALID_NONCE', 'Nonce could not be validated');
      }

      req.nonceVerdict = result;

      if (!result.ok) {
        if (typeof res.status === 'function') {
          const body = {
            error: result.code,
            message: result.message,
          };
          if (result.serverNonce) {
            body.serverNonce = result.serverNonce;
          }
          return res.status(result.status).json(body);
        }
        return next(result);
      }

      if (result.serverNonce && typeof res.set === 'function') {
        res.set('X-Server-Nonce', result.serverNonce);
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  createNonceStore,
  nonceMiddleware,
};