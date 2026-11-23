// Minimal Soroban RPC stub so chaos runs don't depend on testnet availability.
import { createServer } from "node:http";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let id = 1;
    try { id = JSON.parse(body).id ?? 1; } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { status: "healthy", latestLedger: 1 } }));
  });
}).listen(8000, () => console.log("rpc-mock listening on 8000"));
