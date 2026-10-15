const jwt = require('jsonwebtoken');
const OAuthService = require('../services/oauth-service');
const ApiKeyService = require('../services/api-key-service');

const BEARER_PREFIX = 'Bearer ';
const API_KEY_HEADER = 'x-api-key';

function extractBearerToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header || typeof header !== 'string') {
    return null;
  }
  if (!header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function extractApiKey(req) {
  const header = req.headers && (req.headers[API_KEY_HEADER] || req.headers['X-API-Key']);
  if (!header || typeof header !== 'string') {
    return null;
  }
  const key = header.trim();
  return key.length > 0 ? key : null;
}

async function authenticate(req, res, next) {
  try {
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
      const result = await OAuthService.validateAccessToken(bearerToken);
      if (!result || !result.valid) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Invalid or expired access token',
        });
      }

      req.auth = {
        type: 'bearer',
        token: bearerToken,
        userId: result.userId || (result.user && result.user.id) || null,
        clientId: result.clientId || null,
        scopes: Array.isArray(result.scopes) ? result.scopes : [],
        payload: result.payload || result,
      };
      req.userTier = result.tier || (result.user && result.user.tier) || 'free';
      req.apiKeyId = null;
      req.apiKeyScopes = null;
      return next();
    }

    const apiKey = extractApiKey(req);
    if (apiKey) {
      const result = await ApiKeyService.validateKey(apiKey);
      if (!result || !result.valid) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Invalid or revoked API key',
        });
      }

      req.auth = {
        type: 'apiKey',
        userId: result.userId || null,
        clientId: result.clientId || null,
        scopes: Array.isArray(result.scopes) ? result.scopes : [],
      };
      req.apiKeyId = result.keyId || result.id || null;
      req.userTier = result.tier || 'free';
      req.apiKeyScopes = Array.isArray(result.scopes) ? result.scopes : [];
      return next();
    }

    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing authentication credentials',
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Access token expired',
      });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid access token',
      });
    }
    return next(err);
  }
}

function normalizeScopes(scopes) {
  if (!scopes) {
    return [];
  }
  if (Array.isArray(scopes)) {
    return scopes.filter((s) => typeof s === 'string' && s.length > 0);
  }
  if (typeof scopes === 'string') {
    return scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function getRequestScopes(req) {
  if (req.auth && Array.isArray(req.auth.scopes)) {
    return req.auth.scopes;
  }
  if (Array.isArray(req.apiKeyScopes)) {
    return req.apiKeyScopes;
  }
  return [];
}

function requireScopes(requiredScopes) {
  const required = normalizeScopes(requiredScopes);

  return function scopeMiddleware(req, res, next) {
    if (!req.auth) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    if (required.length === 0) {
      return next();
    }

    const granted = getRequestScopes(req);
    const grantedSet = new Set(granted);

    if (grantedSet.has('*') || grantedSet.has('admin')) {
      return next();
    }

    const missing = required.filter((scope) => !grantedSet.has(scope));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Insufficient scope',
        required,
        missing,
      });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  requireScopes,
  extractBearerToken,
  extractApiKey,
};