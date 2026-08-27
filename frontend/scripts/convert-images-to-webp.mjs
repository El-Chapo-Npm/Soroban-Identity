import { promises as fs } from "node:fs";
import path from "node:path";
const publicDir = path.resolve("public");
const sourceExtensions = new Set([".png", ".jpg", ".jpeg"]);

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

let converted = 0;
let sharp;
for (const filename of await walk(publicDir)) {
  if (!sourceExtensions.has(path.extname(filename).toLowerCase())) continue;
  const target = filename.replace(/\.(png|jpe?g)$/i, ".webp");
  const sourceStat = await fs.stat(filename);
  try {
    const targetStat = await fs.stat(target);
    if (targetStat.mtimeMs >= sourceStat.mtimeMs) continue;
  } catch {
    // The WebP does not exist yet.
  }
  if (!sharp) {
    try {
      ({ default: sharp } = await import("sharp"));
    } catch {
      throw new Error("Raster assets were found but Sharp is not installed. Install sharp to run images:webp.");
    }
  }
  await sharp(filename).webp({ quality: 82, effort: 4 }).toFile(target);
  converted += 1;
}

console.log(converted ? `Converted ${converted} image(s) to WebP.` : "No WebP conversions needed.");
