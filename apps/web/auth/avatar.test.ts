import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  avatarKeys,
  isAvatarKey,
  normalizeProfileNickname,
} from "./avatar";

function webpDimensions(contents: Buffer): { width: number; height: number } {
  for (let offset = 12; offset + 8 <= contents.length;) {
    const kind = contents.subarray(offset, offset + 4).toString("ascii");
    const size = contents.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (kind === "VP8X") {
      return {
        width: 1 + contents.readUIntLE(payloadOffset + 4, 3),
        height: 1 + contents.readUIntLE(payloadOffset + 7, 3),
      };
    }
    if (kind === "VP8 " && contents.subarray(payloadOffset + 3, payloadOffset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return {
        width: contents.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: contents.readUInt16LE(payloadOffset + 8) & 0x3fff,
      };
    }
    if (kind === "VP8L" && contents[payloadOffset] === 0x2f) {
      const bits = contents.readUInt32LE(payloadOffset + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    offset = payloadOffset + size + (size % 2);
  }
  throw new Error("WebP dimensions are missing");
}

describe("preset avatar keys", () => {
  test("allows exactly the bundled preset identifiers", () => {
    expect(avatarKeys).toEqual([
      "racer-red",
      "racer-cyan",
      "wheel-fire",
      "track-night",
      "buggy-red",
      "helmet-lime",
    ]);
    expect(isAvatarKey("racer-red")).toBe(true);
  });

  test.each([
    "https://attacker.example/avatar.svg",
    "/assets/avatars/racer-red.webp",
    "data:image/svg+xml,<svg/>",
    "racer-purple",
    "__proto__",
    "constructor",
    null,
    { toString: () => "racer-red" },
  ])("rejects non-preset avatar input %#", (value) => {
    expect(isAvatarKey(value)).toBe(false);
  });
});

describe("profile nickname validation", () => {
  test("normalizes NFKC and outer whitespace before accepting a visible nickname", () => {
    expect(normalizeProfileNickname("  ＲＣ Racer  ")).toBe("RC Racer");
  });

  test.each([
    "ab",
    "a".repeat(25),
    "\nDriver",
    "Driver\u0000One",
    "Driver\u200BOne",
    "Driver\u202EOne",
    "admin",
    "RC Mania",
    "deleted driver",
  ])("rejects an unsafe or reserved nickname %#", (nickname) => {
    expect(normalizeProfileNickname(nickname)).toBeNull();
  });
});

describe("preset avatar assets", () => {
  test("ships every preset as a compact metadata-free 256px WebP", async () => {
    const avatarsDirectory = path.resolve(import.meta.dirname, "../public/assets/avatars");
    for (const avatarKey of avatarKeys) {
      const assetPath = path.join(avatarsDirectory, `${avatarKey}.webp`);
      const [contents, file] = await Promise.all([readFile(assetPath), stat(assetPath)]);

      expect(file.size).toBeLessThan(40 * 1024);
      expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(contents.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(contents.includes(Buffer.from("EXIF"))).toBe(false);
      expect(contents.includes(Buffer.from("XMP "))).toBe(false);
      expect(webpDimensions(contents)).toEqual({ width: 256, height: 256 });
    }
  });
});
