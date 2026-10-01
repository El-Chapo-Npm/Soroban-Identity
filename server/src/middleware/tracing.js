import crypto from "node:crypto";
import { requestContextStore } from "../request-context.js";

/**
 * Request tracing with correlation IDs (#946).
 *
 * Every request gets a correlation ID that is:
 *   - accepted from an inbound `X-Correlation-ID` (or `X-Request-ID`) header
 *     when well-formed, otherwise generated,
 *   - stored in the AsyncLocalStorage request context so the logger mixin
 *     stamps it on every log line,
 *   - echoed back in the `X-Correlation-ID` response header,
 *   - forwarded on outbound calls via `correlationHeaders()` / `correlationEnv()`,
 *   - recorded, with its child spans, in a bounded in-memory `TraceStore`
 *     that backs the `/admin/traces` API and dashboard.
 *
 * See docs/request-tracing.md.
 */

export const CORRELATION_HEADER = "x-correlation-id";
export const CORRELATION_RESPONSE_HEADER = "X-Correlation-ID";
export const CORRELATION_ENV = "SOROBAN_IDENTITY_CORRELATION_ID";

// Printable, header-safe, and bounded so a client cannot inject log noise.
const VALID_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidCorrelationId(value) {
  return typeof value === "string" && VALID_ID.test(value);
}

/** Pick the inbound correlation ID if trustworthy, else mint a new one. */
export function resolveCorrelationId(req) {
  const inbound = firstHeader(req.headers?.[CORRELATION_HEADER]);
  if (isValidCorrelationId(inbound)) return inbound;
  const requestId = firstHeader(req.headers?.["x-request-id"]);
  if (isValidCorrelationId(requestId)) return requestId;
  return crypto.randomUUID();
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** Correlation ID of the request currently executing, or null. */
export function getCorrelationId() {
  return requestContextStore.getStore()?.correlationId ?? null;
}

/** Headers to merge into outbound HTTP calls. */
export function correlationHeaders(correlationId = getCorrelationId()) {
  return correlationId ? { [CORRELATION_HEADER]: correlationId } : {};
}

/** Environment to merge into spawned child processes. */
export function correlationEnv(correlationId = getCorrelationId()) {
  return correlationId ? { [CORRELATION_ENV]: correlationId } : {};
}

/**
 * Bounded ring buffer of recent request traces. Oldest traces are evicted
 * first; spans per trace are capped too so one chatty request cannot grow
 * without limit.
 */
export class TraceStore {
  constructor({ maxTraces = 1000, maxSpansPerTrace = 100, now = () => Date.now() } = {}) {
    this.maxTraces = maxTraces;
    this.maxSpansPerTrace = maxSpansPerTrace;
    this.now = now;
    this.traces = new Map();
  }

  start({ correlationId, requestId = null, method, path, tenantId = null }) {
    const trace = {
      correlationId,
      requestId,
      method,
      path,
      tenantId,
      statusCode: null,
      startedAt: new Date(this.now()).toISOString(),
      startedAtMs: this.now(),
      durationMs: null,
      spans: [],
      droppedSpans: 0,
    };
    // A retried request can reuse a correlation ID; keep the newest.
    this.traces.delete(correlationId);
    this.traces.set(correlationId, trace);
    while (this.traces.size > this.maxTraces) {
      this.traces.delete(this.traces.keys().next().value);
    }
    return trace;
  }

  finish(correlationId, { statusCode }) {
    const trace = this.traces.get(correlationId);
    if (!trace || trace.durationMs !== null) return;
    trace.statusCode = statusCode;
    trace.durationMs = Math.max(0, this.now() - trace.startedAtMs);
  }

  addSpan(correlationId, span) {
    const trace = this.traces.get(correlationId);
    if (!trace) return;
    if (trace.spans.length >= this.maxSpansPerTrace) {
      trace.droppedSpans += 1;
      return;
    }
    trace.spans.push(span);
  }

  get(correlationId) {
    return this.traces.get(correlationId) ?? null;
  }

  /** Newest first, optionally filtered. */
  list({ limit = 100, statusMin = null, pathPrefix = null, minDurationMs = null } = {}) {
    const out = [];
    const all = [...this.traces.values()];
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const t = all[i];
      if (statusMin !== null && (t.statusCode ?? 0) < statusMin) continue;
      if (pathPrefix && !t.path.startsWith(pathPrefix)) continue;
      if (minDurationMs !== null && (t.durationMs ?? 0) < minDurationMs) continue;
      out.push(t);
    }
    return out;
  }

  clear() {
    this.traces.clear();
  }
}

export const defaultTraceStore = new TraceStore({
  maxTraces: Number(process.env.TRACE_STORE_MAX_TRACES) || 1000,
});

/**
 * Attach a correlation ID to the request/response and open a trace record.
 * Returns the correlation ID; callers put it into the request context store
 * so everything downstream (logs, spans, outbound calls) sees it.
 */
export function correlationMiddleware(req, res, { traceStore = defaultTraceStore, requestId = null, path } = {}) {
  const correlationId = resolveCorrelationId(req);
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_RESPONSE_HEADER, correlationId);

  traceStore.start({
    correlationId,
    requestId,
    method: req.method,
    path: path ?? (req.url ?? "/").split("?")[0],
    tenantId: req.tenantId ?? null,
  });
  res.once("finish", () => traceStore.finish(correlationId, { statusCode: res.statusCode }));
  res.once("close", () => traceStore.finish(correlationId, { statusCode: res.statusCode }));
  return correlationId;
}

/**
 * Time `fn` as a named span inside the current request's trace. Works
 * outside a request too (then it just runs `fn`).
 */
export async function traceSpan(name, fn, attributes = {}, { traceStore = defaultTraceStore } = {}) {
  const correlationId = getCorrelationId();
  const started = Date.now();
  let status = "ok";
  let error = null;
  try {
    return await fn();
  } catch (err) {
    status = "error";
    error = err?.message ?? String(err);
    throw err;
  } finally {
    if (correlationId) {
      traceStore.addSpan(correlationId, {
        name,
        startedAt: new Date(started).toISOString(),
        offsetMs: Math.max(0, started - (traceStore.get(correlationId)?.startedAtMs ?? started)),
        durationMs: Date.now() - started,
        status,
        error,
        attributes,
      });
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/**
 * Self-contained HTML dashboard: a trace list plus a waterfall for the
 * selected trace. Data is embedded server-side so it needs no extra fetch.
 */
export function renderTraceDashboard(traces, { selected = null, nonce = "" } = {}) {
  const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
  const rows = traces.map((t) => {
    const cls = (t.statusCode ?? 0) >= 500 ? "err" : (t.statusCode ?? 0) >= 400 ? "warn" : "";
    return `<tr class="${cls}">
      <td><a href="?id=${encodeURIComponent(t.correlationId)}"><code>${escapeHtml(t.correlationId)}</code></a></td>
      <td>${escapeHtml(t.method)}</td><td>${escapeHtml(t.path)}</td>
      <td>${escapeHtml(t.statusCode ?? "…")}</td>
      <td class="num">${t.durationMs ?? "…"}</td>
      <td class="num">${t.spans.length}</td>
      <td>${escapeHtml(t.startedAt)}</td></tr>`;
  }).join("");

  let detail = "";
  if (selected) {
    const total = Math.max(1, selected.durationMs ?? 1);
    const bars = selected.spans.map((s) => {
      const left = Math.min(100, (s.offsetMs / total) * 100);
      const width = Math.max(0.5, Math.min(100 - left, (s.durationMs / total) * 100));
      return `<div class="span"><div class="label">${escapeHtml(s.name)} <span class="muted">${s.durationMs} ms</span></div>
        <div class="track"><div class="bar ${s.status === "error" ? "err" : ""}" style="margin-left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div></div>
        ${s.error ? `<div class="muted">${escapeHtml(s.error)}</div>` : ""}</div>`;
    }).join("");
    detail = `<section><h2>Trace <code>${escapeHtml(selected.correlationId)}</code></h2>
      <p class="muted">${escapeHtml(selected.method)} ${escapeHtml(selected.path)} → ${escapeHtml(selected.statusCode ?? "…")}
      in ${selected.durationMs ?? "…"} ms · request ${escapeHtml(selected.requestId ?? "-")} · tenant ${escapeHtml(selected.tenantId ?? "-")}
      ${selected.droppedSpans ? ` · ${selected.droppedSpans} spans dropped` : ""}</p>
      ${bars || '<p class="muted">No child spans recorded.</p>'}</section>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Request traces</title>
<style${nonceAttr}>
body{font:14px system-ui,sans-serif;margin:0 auto;padding:1rem;max-width:1100px;color:#1d2330;background:#f7f8fa}
table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:.35rem .5rem;border-bottom:1px solid #e3e6eb;text-align:left}
.num{text-align:right;font-variant-numeric:tabular-nums}tr.err td{background:#fdecec}tr.warn td{background:#fff7e0}
.muted{color:#6b7280}.span{margin:.4rem 0}.track{background:#e9ecf1;height:10px;border-radius:3px}
.bar{background:#3b6fd8;height:10px;border-radius:3px}.bar.err{background:#c63d3d}code{font-size:12px}
form{margin:.5rem 0}
</style></head><body>
<h1>Request traces</h1>
<form method="get"><input name="id" placeholder="Correlation ID" size="40"> <button>Find</button></form>
${detail}
<section><h2>Recent</h2><table><thead><tr><th>Correlation ID</th><th>Method</th><th>Path</th><th>Status</th><th class="num">ms</th><th class="num">Spans</th><th>Started</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" class="muted">No traces yet.</td></tr>'}</tbody></table></section>
</body></html>`;
}

/**
 * Handle `/admin/traces*`. Returns true when the request was handled.
 * Caller is responsible for admin auth.
 */
export function handleTraceRoutes(req, res, url, { traceStore = defaultTraceStore, sendJson, nonce } = {}) {
  if (req.method !== "GET") return false;
  const { pathname, searchParams } = url;

  if (pathname === "/admin/traces/dashboard") {
    const id = searchParams.get("id");
    const html = renderTraceDashboard(traceStore.list({ limit: 200 }), {
      selected: id ? traceStore.get(id) : null,
      nonce,
    });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  if (pathname === "/admin/traces") {
    const num = (k) => (searchParams.has(k) ? Number(searchParams.get(k)) : null);
    const limit = Math.min(Math.max(num("limit") ?? 100, 1), 1000);
    const traces = traceStore.list({
      limit,
      statusMin: num("status_min"),
      pathPrefix: searchParams.get("path_prefix"),
      minDurationMs: num("min_duration_ms"),
    });
    sendJson(res, 200, { data: traces, count: traces.length });
    return true;
  }

  const match = pathname.match(/^\/admin\/traces\/([^/]+)$/);
  if (match) {
    const trace = traceStore.get(decodeURIComponent(match[1]));
    if (!trace) sendJson(res, 404, { error: "trace_not_found" });
    else sendJson(res, 200, trace);
    return true;
  }
  return false;
}
