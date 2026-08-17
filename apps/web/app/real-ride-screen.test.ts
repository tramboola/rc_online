import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./real-ride-screen.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("real ride keyboard UI", () => {
  it("keeps the ride covered until the real camera decodes a frame", () => {
    expect(source).toContain("ConnectionLoadingOverlay");
    expect(source).toContain("onLoadedData");
    expect(source).toContain("markVideoLoadedData");
    expect(source).not.toContain("loop.start();\n    loop.arm();");
  });

  it("auto-arms controls and no longer renders a manual arm button", () => {
    expect(source).toContain("loop.arm();");
    expect(source).not.toContain("ARM CONTROLS");
  });

  it("renders each WASD and arrow pair on one line without Escape, Space, or brake", () => {
    expect(source).toContain('label="W" sublabel="/↑"');
    expect(source).toContain('label="A" sublabel="/←"');
    expect(source).toContain('label="S" sublabel="/↓"');
    expect(source).toContain('label="D" sublabel="/→"');
    expect(source).toContain('label="N" sublabel="NITRO"');
    expect(source).not.toContain('label="SPACE"');
    expect(source).not.toContain('"BRAKE"');
    expect(source).not.toContain('"STOP"');
    expect(source).not.toContain("ESC STOP");
    expect(styles).toMatch(/\.real-keycap \{[^}]*display: flex;/s);
    expect(styles).toMatch(/\.real-keyboard-layout \{[^}]*gap: 30px;/s);
  });

  it("renders the keyboard overlay without a surrounding dark frame", () => {
    expect(styles).toMatch(/\.real-keyboard-panel \{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/s);
  });
});
