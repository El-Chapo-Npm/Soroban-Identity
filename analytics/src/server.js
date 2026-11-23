import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aggregator } from './aggregator.js';
import { EventIngestor } from './ingest.js';
import { toCsv, toPdf } from './report.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const aggregator = new Aggregator();
const ingestor = new EventIngestor({
  rpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  contractIds: [process.env.IDENTITY_REGISTRY_ID, process.env.CREDENTIAL_MANAGER_ID],
  startLedger: Number(process.env.START_LEDGER) || undefined,
  aggregator,
});

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(aggregator.snapshot()));
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (snap) => res.write(`data: ${JSON.stringify(snap)}\n\n`);
      send(aggregator.snapshot());
      const off = aggregator.onChange(send);
      return req.on('close', off);
    }
    // Verifications are read-only calls with no on-chain event, so clients report them here.
    if (url.pathname === '/api/track/verification' && req.method === 'POST') {
      const body = await readBody(req);
      aggregator.record({ kind: 'verified', country: body.country ?? req.headers['cf-ipcountry'] });
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/api/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="analytics.csv"' });
      return res.end(toCsv(aggregator.snapshot()));
    }
    if (url.pathname === '/api/export.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="analytics.pdf"' });
      return res.end(toPdf(aggregator.snapshot()));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(await fs.readFile(path.join(publicDir, 'index.html')));
    }
    res.writeHead(404);
    res.end('not found');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

ingestor.start();
server.listen(Number(process.env.PORT ?? 4000), () => console.log(`Analytics on :${process.env.PORT ?? 4000}`));
