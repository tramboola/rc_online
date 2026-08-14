import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./real-ride-screen.tsx", import.meta.url), "utf8");

describe("real ride keyboard UI", () => {
  it("auto-arms controls and no longer renders a manual arm button", () => {
    expect(source).toContain("loop.arm();");
    expect(source).not.toContain("ARM CONTROLS");
  });

  it("renders the verified WASD, Space, and N control map", () => {
    expect(source).toContain('label="W"');
    expect(source).toContain('label="A"');
    expect(source).toContain('label="S"');
    expect(source).toContain('label="D"');
    expect(source).toContain('label="SPACE" sublabel="BRAKE"');
    expect(source).toContain('label="N" sublabel="NITRO"');
  });
});
