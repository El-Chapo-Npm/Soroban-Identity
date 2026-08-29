import crypto from 'node:crypto';
import { logger } from './logger.js';

/**
 * Request Deduplication Middleware (#719)
 *
 * Implements idempotent request handling to prevent duplicate credential issuance
 * from retry attempts. Uses request fingerprints and Redis for storage.
 */

/**
 * Generate a fingerprint from request data.
 * @param {Object} req - Node.js request object
 * @param {Buffer} body - Request body
 * @returns {string} - Fingerprint hash
 */
function generateRequestFingerprint(req, body) {
  const method = req.method;
  const path = req.url;
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  
  // Include key headers in fingerprint to differentiate requests
  const keyIdHeader = req.headers['x-key-id'] || '';
  const authHeader = req.headers.authorization || '';
  
  const fingerprint = `${method}:${path}:${contentHash}:${keyIdHeader}:${authHeader}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

/**
 * Generate or extract idempotency key.
 * @param {Object} req - Node.js request object
 * @param {Buffer} body - Request body
 * @returns {string} - Idempotency key
 */
export function generateIdempotencyKey(req, body) {
  // Check if client provided idempotency key
  const providedKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (providedKey) return providedKey;
  
  // Generate from request fingerprint
  return generateRequestFingerprint(req, body);
}

/**
 * Create request deduplication middleware.
 * @param {Object} redisClient - Redis client
 * @param {Object} options - Configuration options
 * @param {number} options.ttlSeconds - TTL for deduplication window (default: 300 = 5 minutes)
 * @returns {Function} - Middleware function
 */
export function createDeduplicationMiddleware(redisClient, options = {}) {
  const ttlSeconds = options.ttlSeconds || 300; // 5 minutes default
  const prefix = 'dedup:';
  
  return async (req, res, next) => {
    // Only deduplicate POST/PATCH/PUT requests (state-changing operations)
    if (!['POST', 'PATCH', 'PUT'].includes(req.method)) {
      return next();
    }
    
    // Store original response methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let responseBody = null;
    let responseStatus = 200;
    
    // Capture response
    res.json = function(body) {
      responseBody = body;
      return originalJson.call(this, body);
    };
    
    res.send = function(body) {
      responseBody = body;
      return originalSend.call(this, body);
    };
    
    // Store original status method
    const originalStatus = res.status.bind(res);
    res.status = function(code) {
      responseStatus = code;
      return originalStatus.call(this, code);
    };
    
    // Attach idempotency key to request for downstream use
    req.idempotencyKey = null;
    req.isCachedResponse = false;
    
    try {
      if (!redisClient) {
        return next();
      }
      
      // Read and capture request body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const idempotencyKey = generateIdempotencyKey(req, Buffer.from(body));
          const cacheKey = `${prefix}${idempotencyKey}`;
          
          req.idempotencyKey = idempotencyKey;
          
          // Check for existing response
          const cached = await redisClient.get(cacheKey);
          
          if (cached) {
            // Parse and return cached response
            const cachedData = JSON.parse(cached);
            req.isCachedResponse = true;
            
            // Set response headers
            res.setHeader('X-Idempotency-Key', idempotencyKey);
            res.setHeader('X-Deduped', 'true');
            
            // Log deduplication
            logger.debug({
              msg: 'Returning cached response for idempotent request',
              idempotencyKey,
              method: req.method,
              url: req.url,
            });
            
            // Increment deduplication metric
            if (req.metrics) {
              req.metrics.inc('dedup_cache_hit_total', {
                method: req.method,
                endpoint: req.url,
              });
            }
            
            return res.status(cachedData.status).json(cachedData.body);
          }
          
          // Hook into response to cache successful requests
          const originalEnd = res.end.bind(res);
          res.end = function(...args) {
            // Only cache successful responses (2xx)
            if (responseStatus >= 200 && responseStatus < 300 && responseBody) {
              try {
                const cacheData = JSON.stringify({
                  status: responseStatus,
                  body: responseBody,
                  timestamp: Date.now(),
                });
                
                // Store with TTL
                redisClient.setex(cacheKey, ttlSeconds, cacheData)
                  .catch(err => {
                    logger.warn({
                      msg: 'Failed to cache idempotent response',
                      error: err.message,
                      idempotencyKey,
                    });
                  });
              } catch (err) {
                logger.warn({
                  msg: 'Error serializing response for deduplication cache',
                  error: err.message,
                });
              }
            }
            
            // Set deduplication headers
            res.setHeader('X-Idempotency-Key', idempotencyKey);
            res.setHeader('X-Deduped', 'false');
            
            return originalEnd.call(this, ...args);
          };
          
          // Increment request count metric
          if (req.metrics) {
            req.metrics.inc('dedup_request_total', {
              method: req.method,
              endpoint: req.url,
            });
          }
          
          return next();
        } catch (err) {
          logger.error({
            msg: 'Error in deduplication middleware',
            error: err.message,
            stack: err.stack,
          });
          return next();
        }
      });
    } catch (err) {
      logger.error({
        msg: 'Unexpected error in deduplication middleware',
        error: err.message,
        stack: err.stack,
      });
      return next();
    }
  };
}

/**
 * Clear deduplication cache for a specific idempotency key.
 * @param {Object} redisClient - Redis client
 * @param {string} idempotencyKey - The idempotency key to clear
 * @returns {Promise<boolean>}
 */
export async function clearDeduplicationCache(redisClient, idempotencyKey) {
  if (!redisClient) return false;
  
  try {
    const cacheKey = `dedup:${idempotencyKey}`;
    const result = await redisClient.del(cacheKey);
    return result > 0;
  } catch (err) {
    logger.error({
      msg: 'Failed to clear deduplication cache',
      error: err.message,
      idempotencyKey,
    });
    return false;
  }
}

/**
 * Get deduplication cache stats.
 * @param {Object} redisClient - Redis client
 * @returns {Promise<Object>}
 */
export async function getDeduplicationStats(redisClient) {
  if (!redisClient) return null;
  
  try {
    // Get count of deduplication entries
    const keys = await redisClient.keys('dedup:*');
    return {
      cacheEntries: keys.length,
      timestamp: Date.now(),
    };
  } catch (err) {
    logger.error({
      msg: 'Failed to get deduplication stats',
      error: err.message,
    });
    return null;
  }
}
