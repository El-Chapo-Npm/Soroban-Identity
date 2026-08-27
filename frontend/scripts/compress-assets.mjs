import { promises as fs } from "node:fs";
import path from "node:path";
import { brotliCompress, gzip, constants } from "node:zlib";
import { promisify } from "node:util";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const root = path.resolve("dist");
const compressedExtensions = new Set([".br", ".gz", ".zip", ".webp", ".avif"]);
const sourceExtensions = new Set([".js", ".css", ".html", ".svg", ".json", ".wasm", ".txt"]);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(filename)));
    else files.push(filename);
  }
  return files;
}

const files = await walk(root);
const manifest = {};
for (const filename of files) {
  const extension = path.extname(filename).toLowerCase();
  if (!sourceExtensions.has(extension)) continue;
  const source = await fs.readFile(filename);
  const relative = path.relative(root, filename).replaceAll(path.sep, "/");
  const [br, gz] = await Promise.all([
    compressBrotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
    compressGzip(source, { level: 9 }),
  ]);
  await Promise.all([
    fs.writeFile(`${filename}.br`, br),
    fs.writeFile(`${filename}.gz`, gz),
  ]);
  manifest[relative] = {
    bytes: source.byteLength,
    brotliBytes: br.byteLength,
    gzipBytes: gz.byteLength,
    brotliPath: `${relative}.br`,
    gzipPath: `${relative}.gz`,
  };
}

await fs.writeFile(path.join(root, "asset-compression-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const total = Object.values(manifest).reduce((sum, asset) => sum + asset.bytes, 0);
const brotliTotal = Object.values(manifest).reduce((sum, asset) => sum + asset.brotliBytes, 0);
console.log(`Compressed ${Object.keys(manifest).length} assets: ${total} bytes source, ${brotliTotal} bytes Brotli.`);
