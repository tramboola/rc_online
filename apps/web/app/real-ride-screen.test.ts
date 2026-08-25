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

  it("keeps connection and steering trim controls readable without opaque camera blockers", () => {
    expect(source).toContain('className="real-ride-status"');
    expect(source).not.toContain('className="real-ride-status data-panel"');
    expect(styles).toMatch(/\.real-ride-status \{[^}]*background: transparent;[^}]*border: 0;[^}]*box-shadow: none;/s);
    expect(styles).toMatch(/\.real-steering-trim \{[^}]*background: transparent;[^}]*border: 0;[^}]*filter: none;/s);
  });

  it("provides a separate hold-to-use mobile nitro control", () => {
    const mobileSource = readFileSync(new URL("./mobile-drive-controls.tsx", import.meta.url), "utf8");
    expect(mobileSource).toContain("NITRO");
    expect(mobileSource).not.toContain("63% MAX");
    expect(mobileSource).not.toContain("HOLD · 100%");
    expect(mobileSource).toContain("onPointerDown");
    expect(mobileSource).toContain("onPointerUp");
    expect(styles).toContain(".mobile-nitro-button");
  });

  it("provides a compact mobile end-session button wired to the existing end action", () => {
    expect(source).toContain('className="mobile-end-session" onClick={() => setEndConfirmationOpen(true)}');
    expect(source).toContain("ARE YOU SURE?");
    expect(source).toContain('className="mobile-end-confirm"');
    expect(styles).toContain(".mobile-end-session");
  });

  it("opens steering neutral adjustment from a dedicated mobile button", () => {
    expect(source).toContain('className="mobile-steering-trim-toggle"');
    expect(source).toContain("SET STEERING NEUTRAL");
    expect(styles).toContain(".mobile-steering-trim-toggle");
    expect(styles).toContain('.real-steering-trim[data-mobile-open="true"]');
  });

  it("tracks the dynamic mobile viewport when Safari hides its toolbar", () => {
    expect(styles).toMatch(/\.real-ride-page \{[^}]*height: 100dvh;/s);
    expect(styles).not.toMatch(/\.real-ride-page \{[^}]*height: 100svh;/s);
  });

  it("uses nearly the full mobile ride height for proportional throttle", () => {
    expect(styles).toMatch(/\.mobile-throttle-pad \{[^}]*top: 48px;[^}]*bottom: 10px;/s);
  });
});
