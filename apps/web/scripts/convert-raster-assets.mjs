import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");
const legacyRasterPattern = /\.(png|jpe?g)$/iu;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}

const inputs = (await filesBelow(publicRoot))
  .filter((file) => legacyRasterPattern.test(file))
  .sort();

let sourceBytes = 0;
let outputBytes = 0;

for (const source of inputs) {
  const target = source.replace(legacyRasterPattern, ".webp");
  sourceBytes += (await stat(source)).size;

  await sharp(source)
    .webp({
      quality: 82,
      alphaQuality: 90,
      smartSubsample: true,
      effort: 6,
    })
    .toFile(target);

  outputBytes += (await stat(target)).size;
  await rm(source);
}

const reduction = sourceBytes === 0
  ? 0
  : Math.round((1 - outputBytes / sourceBytes) * 100);

process.stdout.write(
  `Converted ${inputs.length} raster assets: ${sourceBytes} -> ${outputBytes} bytes (${reduction}% smaller)\n`,
);
