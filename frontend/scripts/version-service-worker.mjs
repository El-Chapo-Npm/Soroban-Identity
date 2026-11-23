import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, '..', 'dist');
const serviceWorkerPath = path.join(distDir, 'sw.js');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
let versionSource = serviceWorker;
try {
  versionSource += await readFile(manifestPath, 'utf8');
} catch {
  // Older Vite versions may not emit a manifest in the expected location.
}

const version = createHash('sha256').update(versionSource).digest('hex').slice(0, 12);
const updated = serviceWorker.replace(
  /const CACHE_VERSION = '[^']+';/,
  `const CACHE_VERSION = '${version}';`,
);
if (updated === serviceWorker) {
  throw new Error('Service worker cache version declaration was not found.');
}
await writeFile(serviceWorkerPath, updated);
console.log(`Service worker cache version: ${version}`);
