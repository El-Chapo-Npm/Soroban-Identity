import { promises as fs } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const maxInitialKb = Number(process.env.BUNDLE_MAX_INITIAL_KB ?? 750);
const maxTotalJsKb = Number(process.env.BUNDLE_MAX_TOTAL_JS_KB ?? 5000);
const maxTotalAssetKb = Number(process.env.BUNDLE_MAX_TOTAL_ASSET_KB ?? 7000);

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

const files = await walk(dist);
const assets = [];
for (const filename of files) {
  if (!/\.(?:js|css|wasm|woff2?|png|jpe?g|gif|svg|webp|ico)$/i.test(filename)) continue;
  assets.push({
    file: path.relative(dist, filename).replaceAll(path.sep, "/"),
    bytes: (await fs.stat(filename)).size,
  });
}
const js = assets.filter(({ file }) => file.endsWith(".js"));
let initial = js.filter(({ file }) => !file.includes("/"));
for (const manifestFile of [path.join(dist, ".vite/manifest.json"), path.join(dist, "manifest.json")]) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    const entryFiles = new Set(Object.values(manifest).filter((entry) => entry.isEntry).map((entry) => entry.file));
    const manifestInitial = js.filter(({ file }) => entryFiles.has(file));
    if (manifestInitial.length > 0) {
      initial = manifestInitial;
      break;
    }
  } catch {
    // Vite may be configured without a manifest in local checks.
  }
}
const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);
const metrics = {
  generatedAt: new Date().toISOString(),
  initialJavaScriptBytes: sum(initial),
  totalJavaScriptBytes: sum(js),
  totalAssetBytes: sum(assets),
  budgets: {
    initialJavaScriptKb: maxInitialKb,
    totalJavaScriptKb: maxTotalJsKb,
    totalAssetKb: maxTotalAssetKb,
  },
  assets: assets.sort((a, b) => b.bytes - a.bytes),
};

await fs.writeFile(path.join(dist, "bundle-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
const kib = (bytes) => (bytes / 1024).toFixed(1);
console.log(`Initial JavaScript: ${kib(metrics.initialJavaScriptBytes)} KiB / ${maxInitialKb} KiB`);
console.log(`Total JavaScript: ${kib(metrics.totalJavaScriptBytes)} KiB / ${maxTotalJsKb} KiB`);
console.log(`Total assets: ${kib(metrics.totalAssetBytes)} KiB / ${maxTotalAssetKb} KiB`);

const failures = [];
if (metrics.initialJavaScriptBytes > maxInitialKb * 1024) failures.push("initial JavaScript budget");
if (metrics.totalJavaScriptBytes > maxTotalJsKb * 1024) failures.push("total JavaScript budget");
if (metrics.totalAssetBytes > maxTotalAssetKb * 1024) failures.push("total asset budget");
if (failures.length > 0) {
  console.error(`Bundle budget exceeded: ${failures.join(", ")}.`);
  process.exitCode = 1;
}
