import { readdir, readFile } from "node:fs/promises";
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
});
