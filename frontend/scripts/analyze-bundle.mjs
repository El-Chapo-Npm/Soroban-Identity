import { promises as fs } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else if (/\.(?:js|css|wasm|woff2?|png|jpe?g|gif|svg|webp|ico)$/i.test(filename)) {
      files.push({ name: path.relative(dist, filename).replaceAll(path.sep, "/"), bytes: (await fs.stat(filename)).size });
    }
  }
}
await walk(dist);
files.sort((a, b) => b.bytes - a.bytes);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const rows = files.map(({ name, bytes }) => `<tr><td>${name}</td><td>${(bytes / 1024).toFixed(1)} KiB</td><td><span style="width:${Math.max(1, (bytes / total) * 100)}%"></span></td></tr>`).join("\n");
const html = `<!doctype html>
<meta charset="utf-8">
<title>Soroban Identity bundle report</title>
<style>body{font:15px system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#172033}table{width:100%;border-collapse:collapse}td{padding:.5rem;border-bottom:1px solid #e5e7eb}td:nth-child(2){text-align:right;white-space:nowrap}td span{display:block;height:.8rem;background:#7c3aed;border-radius:999px}</style>
<h1>Frontend bundle report</h1><p>Total analyzed output: ${(total / 1024).toFixed(1)} KiB. Generated ${new Date().toISOString()}.</p><table><thead><tr><th align="left">Asset</th><th>Size</th><th align="left">Relative size</th></tr></thead><tbody>${rows}</tbody></table>`;
await fs.writeFile(path.join(dist, "bundle-report.html"), html);
console.log(`Wrote bundle-report.html for ${files.length} assets.`);
