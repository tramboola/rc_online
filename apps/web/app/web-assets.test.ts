import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const publicDir = path.resolve(import.meta.dirname, "../public");

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}

function readWebpDimensions(contents: Buffer): { height: number; width: number } {
  for (let offset = 12; offset + 8 <= contents.length;) {
    const chunkType = contents.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = contents.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === "VP8 ") {
      return {
        height: contents.readUInt16LE(dataOffset + 8) & 0x3fff,
        width: contents.readUInt16LE(dataOffset + 6) & 0x3fff,
      };
    }
    if (chunkType === "VP8L") {
      const dimensions = contents.readUInt32LE(dataOffset + 1);
      return {
        height: ((dimensions >>> 14) & 0x3fff) + 1,
        width: (dimensions & 0x3fff) + 1,
      };
    }
    if (chunkType === "VP8X") {
      return {
        height: contents.readUIntLE(dataOffset + 7, 3) + 1,
        width: contents.readUIntLE(dataOffset + 4, 3) + 1,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("WebP dimensions were not found");
}

describe("web raster assets", () => {
  test("ships no PNG or JPEG files or source references", async () => {
    const files = await filesBelow(publicDir);
    expect(files.filter((file) => /\.(png|jpe?g)$/iu.test(file))).toEqual([]);

    const screen = await readFile(
      new URL("./simulation-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(screen).not.toMatch(/\.(png|jpe?g)["']/iu);
  });

  test("ships the selected challenge wheel as a transparent WebP", async () => {
    const asset = path.join(
      publicDir,
      "assets",
      "challenge-burning-wheel.webp",
    );
    const exists = await stat(asset).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const contents = await readFile(asset);
    expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(contents.subarray(8, 12).toString("ascii")).toBe("WEBP");

    const extendedHeader = contents.indexOf(Buffer.from("VP8X"));
    expect(extendedHeader).toBeGreaterThanOrEqual(12);
    const flags = contents[extendedHeader + 8] ?? 0;
    expect(flags & 0x10).toBe(0x10);

    const width = 1 + contents.readUIntLE(extendedHeader + 12, 3);
    const height = 1 + contents.readUIntLE(extendedHeader + 15, 3);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("ships the loading screen artwork as WebP", async () => {
    for (const fileName of [
      "loading-background.webp",
      "loading-logo.webp",
    ]) {
      const contents = await readFile(path.join(publicDir, "assets", fileName));
      expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(contents.subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
  });

  test("keeps the progressive loading backgrounds within their render and transfer budgets", async () => {
    const full = path.join(publicDir, "assets", "loading-background.webp");
    const preview = path.join(publicDir, "assets", "loading-background-preview.webp");
    const [fullContents, previewContents, fullStat, previewStat] = await Promise.all([
      readFile(full),
      readFile(preview),
      stat(full),
      stat(preview),
    ]);

    expect(readWebpDimensions(fullContents)).toEqual({ width: 1280, height: 720 });
    expect(fullStat.size).toBeLessThanOrEqual(80 * 1024);
    expect(readWebpDimensions(previewContents)).toEqual({ width: 320, height: 180 });
    expect(previewStat.size).toBeLessThanOrEqual(12 * 1024);
  });
});
