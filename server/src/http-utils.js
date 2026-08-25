import crypto from 'node:crypto';
import { logger } from './logger.js';

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 *
 * Always runs in O(n) time relative to the expected value's length,
 * regardless of whether the supplied value matches or where it first
 * differs — preventing character-by-character timing oracle attacks.
 *
 * @param {string} supplied  - Value provided by the caller
 * @param {string} expected  - Trusted reference value
 * @returns {boolean}
 */
function timingSafeCompare(supplied, expected) {
  const expectedBuf = Buffer.from(expected, 'utf8');
  // Always allocate a buffer of the correct length and run the comparison
  // so the timing does not reveal whether lengths matched.
  const suppliedBuf = Buffer.alloc(expectedBuf.length);
  Buffer.from(supplied, 'utf8').copy(suppliedBuf);
  // Length mismatch means they cannot be equal, but we still run the
  // constant-time comparison to avoid leaking the expected length via timing.
  const lengthMatch = Buffer.from(supplied, 'utf8').length === expectedBuf.length;
  return crypto.timingSafeEqual(suppliedBuf, expectedBuf) && lengthMatch;
}

/**
 * Returns true and sends 415 when the request is a non-GET/DELETE method
 * and the Content-Type is not application/json.
 */
export function validateContentType(req, res) {
  if (req.method === "GET" || req.method === "DELETE" || req.method === "OPTIONS") return false;
  const ct = req.headers["content-type"] ?? "";
  if (ct.toLowerCase().startsWith("application/json")) return false;
  sendFormatted(req, res, 415, { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" });
  return true;
}

export async function readJson(req, config) {
  // Check Content-Length header first
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined) {
    const length = Number.parseInt(contentLength, 10);
    if (length > config.maxBodyBytes) {
      const remoteIp =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket?.remoteAddress ||
        "unknown";
      logger.warn({
        remoteIp,
        contentLength: length,
        limit: config.maxBodyBytes
      }, 'Payload too large (Content-Length check)');
      return { __payloadTooLarge: true };
    }
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > config.maxBodyBytes) {
      const remoteIp =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket?.remoteAddress ||
        "unknown";
      logger.warn({
        remoteIp,
        totalBytes,
        limit: config.maxBodyBytes
      }, 'Payload too large (streaming check)');
      return { __payloadTooLarge: true };
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function sendText(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

export const SUPPORTED_MEDIA_TYPES = [
  "application/json",
  "application/xml",
  "text/xml",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
];

/**
 * Escape XML special characters.
 */
export function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a JavaScript object / value into an XML document string.
 */
export function toXml(data, rootElement = "response") {
  function serializeNode(value, tagName) {
    const tag = /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(tagName) ? tagName : "item";
    if (value === null || value === undefined) {
      return `<${tag}/>`;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      return `<${tag}>${value}</${tag}>`;
    }
    if (typeof value === "string") {
      return `<${tag}>${escapeXml(value)}</${tag}>`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return `<${tag}/>`;
      }
      const itemTagName = tag.endsWith("s") && tag.length > 1 ? tag.slice(0, -1) : "item";
      const elements = value.map((item) => serializeNode(item, itemTagName)).join("");
      return `<${tag}>${elements}</${tag}>`;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return `<${tag}/>`;
      }
      const elements = keys.map((key) => serializeNode(value[key], key)).join("");
      return `<${tag}>${elements}</${tag}>`;
    }
    return `<${tag}>${escapeXml(String(value))}</${tag}>`;
  }

  let body = "";
  if (data === null || data === undefined) {
    body = `<${rootElement}/>`;
  } else if (Array.isArray(data)) {
    const elements = data.map((item) => serializeNode(item, "item")).join("");
    body = `<${rootElement}>${elements}</${rootElement}>`;
  } else if (typeof data === "object") {
    const keys = Object.keys(data);
    const elements = keys.map((key) => serializeNode(data[key], key)).join("");
    body = `<${rootElement}>${elements}</${rootElement}>`;
  } else {
    body = `<${rootElement}>${escapeXml(String(data))}</${rootElement}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

/**
 * Format a JavaScript object / value into a YAML document string.
 */
export function toYaml(data, indent = 0) {
  const spaces = "  ".repeat(indent);

  if (data === null || data === undefined) {
    return "null";
  }
  if (typeof data === "boolean" || typeof data === "number") {
    return String(data);
  }
  if (typeof data === "string") {
    if (
      data === "" ||
      /[\n\r:#{}[\],&*!|>'%@`\\]/.test(data) ||
      /^(true|false|null|yes|no|on|off)$/i.test(data) ||
      /^[-+]?[0-9]+(\.[0-9]+)?$/.test(data)
    ) {
      return JSON.stringify(data);
    }
    return data;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    return data
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const itemYaml = toYaml(item, indent + 1);
          const trimmed = itemYaml.trimStart();
          return `${spaces}- ${trimmed}`;
        }
        return `${spaces}- ${toYaml(item, indent + 1)}`;
      })
      .join("\n");
  }
  if (typeof data === "object") {
    const entries = Object.entries(data);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, val]) => {
        const formattedKey = /^[a-zA-Z0-9_-]+$/.test(key)
          ? key
          : JSON.stringify(key);
        if (
          typeof val === "object" &&
          val !== null &&
          (Array.isArray(val) ? val.length > 0 : Object.keys(val).length > 0)
        ) {
          return `${spaces}${formattedKey}:\n${toYaml(val, indent + 1)}`;
        }
        return `${spaces}${formattedKey}: ${toYaml(val, indent + 1)}`;
      })
      .join("\n");
  }
  return String(data);
}

/**
 * Negotiate response content-type based on Accept header.
 * Returns standard media type string ("application/json", "application/xml", "application/yaml"),
 * or null if no acceptable media type is matched.
 */
export function negotiateContentType(acceptHeader) {
  if (!acceptHeader || acceptHeader.trim() === "") {
    return "application/json";
  }

  const parts = acceptHeader.split(",");
  const preferences = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [mediaTypePart, ...params] = trimmed.split(";");
    const mediaType = mediaTypePart.trim().toLowerCase();
    let q = 1.0;
    for (const param of params) {
      const [k, v] = param.trim().split("=");
      if (k && k.trim() === "q" && v) {
        const parsedQ = parseFloat(v.trim());
        if (!isNaN(parsedQ)) q = parsedQ;
      }
    }
    if (q > 0) {
      preferences.push({ mediaType, q });
    }
  }

  // Sort by q factor descending
  preferences.sort((a, b) => b.q - a.q);

  for (const { mediaType } of preferences) {
    if (
      mediaType === "*/*" ||
      mediaType === "application/*" ||
      mediaType === "application/json"
    ) {
      return "application/json";
    }
    if (mediaType === "application/xml" || mediaType === "text/xml") {
      return "application/xml";
    }
    if (
      mediaType === "application/yaml" ||
      mediaType === "application/x-yaml" ||
      mediaType === "text/yaml" ||
      mediaType === "text/x-yaml"
    ) {
      return "application/yaml";
    }
    if (mediaType === "text/*") {
      return "text/xml";
    }
  }

  return null;
}

/**
 * Send a formatted response respecting content negotiation (JSON, XML, YAML).
 * Returns 406 Not Acceptable if client requested an unsupported format.
 */
export function sendFormatted(req, res, statusCode, body, headers = {}) {
  const accept = req?.headers ? req.headers["accept"] : undefined;
  const matchedFormat = negotiateContentType(accept);

  if (!matchedFormat) {
    res.writeHead(406, {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    });
    res.end(
      JSON.stringify({
        error: "not_acceptable",
        code: "NOT_ACCEPTABLE",
        message:
          "Unsupported format requested in Accept header. Supported formats: application/json, application/xml, text/xml, application/yaml, text/yaml",
        supportedFormats: [
          "application/json",
          "application/xml",
          "text/xml",
          "application/yaml",
          "text/yaml",
        ],
      }),
    );
    return;
  }

  if (matchedFormat === "application/xml" || matchedFormat === "text/xml") {
    res.writeHead(statusCode, {
      "content-type": "application/xml; charset=utf-8",
      ...headers,
    });
    res.end(toXml(body));
    return;
  }

  if (
    matchedFormat === "application/yaml" ||
    matchedFormat === "application/x-yaml" ||
    matchedFormat === "text/yaml" ||
    matchedFormat === "text/x-yaml"
  ) {
    res.writeHead(statusCode, {
      "content-type": "application/yaml; charset=utf-8",
      ...headers,
    });
    res.end(toYaml(body));
    return;
  }

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function notFound(res, req = null) {
  if (req) {
    return sendFormatted(req, res, 404, { error: "not_found" });
  }
  sendJson(res, 404, { error: "not_found" });
}

/**
 * Authenticate and authorize a request with optional scope requirements.
 * 
 * @param {object} req - HTTP request object
 * @param {object} res - HTTP response object
 * @param {object} config - Server configuration
 * @param {string[]} requiredScopes - Array of required scopes (e.g., ['credentials:write'])
 * @returns {boolean} True if authenticated and authorized, false otherwise
 */
export function requireAuth(req, res, config, requiredScopes = []) {
  if (!config.adminApiKey) {
    sendFormatted(req, res, 503, { 
      error: "admin_api_key_not_configured",
      code: "SERVICE_UNAVAILABLE",
      message: "API key authentication is not configured"
    });
    return false;
  }
  
  const token =
    req.headers["x-api-key"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
    
  if (!token) {
    sendFormatted(req, res, 401, { 
      error: "unauthorized",
      code: "UNAUTHORIZED",
      message: "Missing API key"
    });
    return false;
  }
  
  // Parse API key record if it contains scope information
  // Format: apiKey:scope1,scope2,scope3 or just apiKey for full access
  const [keyPart, scopesPart] = token.split(':');
  const keyScopes = scopesPart ? scopesPart.split(',') : [];
  
  // Constant-time API key comparison to prevent timing side-channel attacks.
  if (!timingSafeCompare(keyPart, config.adminApiKey)) {
    sendFormatted(req, res, 401, { 
      error: "unauthorized",
      code: "UNAUTHORIZED",
      message: "Invalid API key"
    });
    return false;
  }
  
  // If this is the admin key without scopes, grant full access
  if (!scopesPart) {
    req.apiKeyScopes = ['*'];
    return true;
  }
  
  // Check if required scopes are present
  if (requiredScopes.length > 0) {
    const hasWildcard = keyScopes.includes('*');
    const hasAllScopes = requiredScopes.every(required => 
      hasWildcard || keyScopes.includes(required)
    );
    
    if (!hasAllScopes) {
      const missingScopes = requiredScopes.filter(s => !keyScopes.includes(s));
      sendFormatted(req, res, 403, { 
        error: "forbidden",
        code: "INSUFFICIENT_SCOPE",
        message: "API key does not have required permissions",
        requiredScopes,
        missingScopes
      });
      return false;
    }
  }
  
  req.apiKeyScopes = keyScopes;
  return true;
}

/**
 * Legacy admin check - maintains backward compatibility
 */
export function requireAdmin(req, res, config) {
  return requireAuth(req, res, config, []);
}

/**
 * Determine the allowed origin for CORS based on the request origin
 * and the configured allowed origins list.
 */
export function getAllowedOrigin(requestOrigin, allowedOrigins) {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return null;
  }
  if (allowedOrigins.includes("*")) {
    return "*";
  }
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/**
 * Set CORS headers on the response.
 * Handles preflight OPTIONS requests and actual requests.
 */
export function setCorsHeaders(req, res, config) {
  const requestOrigin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(
    requestOrigin,
    config.corsAllowedOrigins,
  );

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    // Per the CORS spec, credentials cannot be used with a wildcard origin.
    // Only send the header when a specific (non-wildcard) origin is reflected.
    if (allowedOrigin !== "*") {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }

  // Add to Access-Control-Expose-Headers
  res.setHeader("Access-Control-Expose-Headers", "X-Request-ID, Content-Type");

  // Handle preflight OPTIONS
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key, X-Request-ID, X-Actor",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    return true; // Handled, respond with 204
  }

  return false; // Not a preflight, continue with actual request
}
