/**
 * Version detection middleware for API versioning (#878).
 *
 * Wraps resolveApiVersion / setVersionHeaders from versioning.js as a
 * composable middleware factory so individual route modules can opt in
 * without duplicating the negotiation logic.
 */

import {
  resolveApiVersion,
  setVersionHeaders,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  DEPRECATED_VERSIONS,
} from "../versioning.js";

export { SUPPORTED_VERSIONS, DEFAULT_VERSION, DEPRECATED_VERSIONS };

/**
 * Apply version negotiation to `req` / `res` and return the resolved info.
 *
 * Sets response headers (`X-API-Version`, `X-Supported-Versions`, and
 * deprecation headers when applicable) and attaches `req.apiVersion` and
 * `req.versionedPath` for downstream handlers.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse}  res
 * @param {URL} url  Already-parsed URL for this request.
 * @returns {{ version: string, normalizedPath: string, isDeprecated: boolean }}
 */
export function applyVersioning(req, res, url) {
  const info = resolveApiVersion(req, url);
  setVersionHeaders(res, info);
  req.apiVersion = info.version;
  req.versionedPath = info.normalizedPath;
  return info;
}

/**
 * Return true when `version` is among the currently supported versions.
 *
 * @param {string} version  e.g. "v1" or "v2"
 */
export function isSupportedVersion(version) {
  return SUPPORTED_VERSIONS.includes(version);
}

/**
 * Return true when `version` is currently deprecated.
 *
 * @param {string} version
 */
export function isDeprecatedVersion(version) {
  return DEPRECATED_VERSIONS.includes(version);
}

/**
 * Middleware factory: returns an async function that resolves the API version
 * for every request and makes the version available via `req.apiVersion`.
 *
 * Designed for use in test suites and future framework integrations where a
 * standalone middleware function (rather than inline app.js logic) is needed.
 *
 * @returns {(req, res, next) => void}
 */
export function createVersionMiddleware() {
  return function versionMiddleware(req, res, next) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      applyVersioning(req, res, url);
      if (typeof next === "function") next();
    } catch (err) {
      if (typeof next === "function") next(err);
    }
  };
}
