import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config";
import { AnalyticsStore } from "./store";
import { Indexer } from "./indexer";
import { computeSummary, type Summary } from "./metrics";
import { REPORTS, buildReport, type ReportFormat, type ReportName } from "./reports";

const PUBLIC_DIR = path.resolve(__dirname, "../public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const MAX_BODY = 4096;

const config = loadConfig();
const store = new AnalyticsStore(config.dataFile);
const indexer = new Indexer(config, store);

// Summary is recomputed only when the store changes.
let summary: Summary = computeSummary(store.data);
const clients = new Set<http.ServerResponse>();

store.on("change", () => {
  summary = computeSummary(store.data);
  const frame = `event: summary\ndata: ${JSON.stringify(summary)}\n\n`;
  for (const res of clients) res.write(frame);
});

// Keep SSE connections alive through proxies, and roll the 24h windows forward.
setInterval(() => {
  summary = computeSummary(store.data);
  for (const res of clients) res.write(`: ping\n\n`);
}, 25_000).unref();

function send(res: http.ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body);
}

function tokenMatches(header: string | undefined): boolean {
  if (!config.reportToken || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.reportToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Apps that verify credentials via simulation (the common case) can report
 * the outcome here so verification frequency covers off-ledger checks too.
 */
async function handleReport(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!tokenMatches(req.headers.authorization)) return send(res, 401, `{"error":"unauthorized"}`);

  let body: { credentialId?: unknown; valid?: unknown; reason?: unknown };
  try {
    body = (await readJson(req)) as typeof body;
  } catch {
    return send(res, 400, `{"error":"invalid JSON body"}`);
  }

  const credentialId = typeof body.credentialId === "string" && /^[0-9a-f]{64}$/i.test(body.credentialId)
    ? body.credentialId.toLowerCase()
    : undefined;
  if (!credentialId) return send(res, 400, `{"error":"credentialId must be 64 hex chars"}`);

  store.addVerification({
    id: `report:${randomUUID()}`,
    source: "reported",
    credentialId,
    valid: typeof body.valid === "boolean" ? body.valid : undefined,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 32) : undefined,
    ts: Date.now(),
  });
  store.flush();
  send(res, 202, `{"ok":true}`);
}

function handleStream(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`retry: 5000\nevent: summary\ndata: ${JSON.stringify(summary)}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function handleExport(url: URL, res: http.ServerResponse) {
  const name = (url.searchParams.get("report") ?? "summary") as ReportName;
  const format = (url.searchParams.get("format") ?? "csv") as ReportFormat;
  if (!REPORTS.includes(name) || (format !== "csv" && format !== "json")) {
    return send(res, 400, JSON.stringify({ error: "unknown report or format", reports: REPORTS, formats: ["csv", "json"] }));
  }
  const report = buildReport(name, format, summary, store.data);
  res.writeHead(200, {
    "Content-Type": report.contentType,
    "Content-Disposition": `attachment; filename="${report.filename}"`,
  });
  res.end(report.body);
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  const file = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, `{"error":"not found"}`);
  fs.readFile(file, (err, content) => {
    if (err) return send(res, 404, `{"error":"not found"}`);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/summary") return send(res, 200, JSON.stringify(summary));
  if (req.method === "GET" && url.pathname === "/api/stream") return handleStream(req, res);
  if (req.method === "GET" && url.pathname === "/api/export") return handleExport(url, res);
  if (req.method === "POST" && url.pathname === "/api/verifications") return void handleReport(req, res);
  if (req.method === "GET" && url.pathname === "/healthz") {
    return send(res, 200, JSON.stringify({ ok: true, latestLedger: store.data.cursor.latestLedger ?? null }));
  }
  if (req.method === "GET") return serveStatic(url.pathname, res);
  send(res, 405, `{"error":"method not allowed"}`);
});

server.listen(config.port, () => {
  console.log(`[analytics] dashboard on http://localhost:${config.port}`);
  indexer.start();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    indexer.stop();
    store.flush();
    server.close(() => process.exit(0));
    for (const res of clients) res.end();
  });
}
