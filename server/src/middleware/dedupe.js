import crypto from "node:crypto";
import { readRawBody } from "../http-utils.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

function fingerprint(req, body) {
  const identity = req.headers["x-api-key"] ?? req.headers.authorization ?? req.headers["x-key-id"] ?? "anonymous";
  return crypto.createHash("sha256")
    .update(`${req.method}\n${req.url}\n${identity}\n`)
    .update(body)
    .digest("hex");
}

function replay(res, cached, hit) {
  if (res.headersSent) return;
  res.writeHead(cached.statusCode, { ...cached.headers, "X-Dedupe-Hit": hit ? "true" : "false" });
  res.end(cached.body);
}

/**
 * Native HTTP request deduplication. The body is buffered once and memoised
 * on req, so downstream readJson/readRawBody consumers see the same bytes.
 * Only mutating requests are eligible; authentication remains in the normal
 * handler and the fingerprint includes the caller identity.
 */
export function createRequestDeduplication({ ttlMs = 5000, maxEntries = 2048 } = {}) {
  const entries = new Map();

  const prune = (now) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };

  return async function dedupe(req, res, next, config) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    const raw = await readRawBody(req, config);
    if (raw.tooLarge) return next();
    const key = fingerprint(req, raw.buffer);
    const now = Date.now();
    prune(now);
    const existing = entries.get(key);
    if (existing && existing.expiresAt > now) {
      const cached = await existing.promise;
      replay(res, cached, true);
      return;
    }

    let resolveResponse;
    const promise = new Promise((resolve) => { resolveResponse = resolve; });
    entries.set(key, { promise, expiresAt: now + ttlMs });
    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let headers = {};
    const chunks = [];
    res.writeHead = (status, responseHeaders = {}) => {
      statusCode = status;
      headers = { ...responseHeaders };
      return originalWriteHead(status, responseHeaders);
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      const body = Buffer.concat(chunks);
      resolveResponse({ statusCode, headers: { ...headers }, body });
      return originalEnd(chunk, encoding, callback);
    };
    try {
      await next();
    } catch (error) {
      entries.delete(key);
      resolveResponse({ statusCode: 500, headers: {}, body: Buffer.from(JSON.stringify({ error: "internal_server_error" })) });
      throw error;
    }
    if (!res.writableEnded && !res.headersSent) {
      entries.delete(key);
      resolveResponse({ statusCode: 204, headers: {}, body: Buffer.alloc(0) });
    }
  };
}
