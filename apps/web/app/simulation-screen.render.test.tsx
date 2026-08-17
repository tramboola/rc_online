import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SimulationScreen } from "./simulation-screen";

const source = readFileSync(new URL("./simulation-screen.tsx", import.meta.url), "utf8");

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("demo=1"),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

describe("driving setup screens", () => {
  it("renders keyboard controls as the default preflight setup", () => {
    const markup = renderToStaticMarkup(
      <SimulationScreen adminAccess mockMode screen="preflight" />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('class="keyboard-asset"');
    expect(markup).toContain('class="keyboard-wasd"');
    expect(markup).toContain('class="keyboard-nitro-key"');
    expect(markup).toContain('class="control-bindings"');
    expect(markup).toContain("W / ↑");
    expect(markup).toContain("A / ←");
    expect(markup).toContain("S / ↓");
    expect(markup).toContain("D / →");
    expect(markup).toContain("NITRO");
    expect(markup).not.toContain("ESC");
    expect(markup).not.toContain("controller-gamepad.webp");
    expect(markup).not.toContain("SPACE");
    expect(markup).not.toContain("BRAKE");
    expect(markup).not.toContain("CALIBRATION");
    expect(markup).not.toContain("RETEST");
    expect(markup).not.toContain("HTTPS SECURE");
    expect(markup).toContain("COMING SOON");
    expect(markup).toContain("disabled");
    expect(source).toContain('window.addEventListener("keydown"');
    expect(source).toContain('window.addEventListener("keyup"');
    expect(source).toContain('window.addEventListener("blur"');
    expect(source).not.toContain('logicalKey === "STOP"');
  });

  it("renders a queue offer without an acceptance countdown", () => {
    const markup = renderToStaticMarkup(
      <SimulationScreen
        adminAccess
        mockMode
        operationalStatus={{
          state: "ready",
          cars: [{
            id: "40000000-0000-4000-8000-000000000001",
            name: "RC Mania One",
            slug: "rc-mania-one",
            batteryPercent: null,
          }],
          queueCount: 0,
        }}
        screen="queue"
      />,
    );

    expect(markup).toContain("Choose a car when you&#x27;re ready.");
    expect(markup).not.toContain("Accept within");
    expect(markup).not.toContain("countdown");
    expect(markup).toContain("LEAVE QUEUE");
    expect(source).toContain("router.push(getRideUrl(selectedCar))");
    expect(source).not.toContain("router.push(getConnectionUrl(selectedCar))");
  });

  it("renders the car connection loading screen", () => {
    const markup = renderToStaticMarkup(
      <SimulationScreen adminAccess mockMode screen="loading" />,
    );

    expect(markup).toContain("CONNECTING TO CAR");
    expect(markup).toContain("SYSTEM LOG");
    expect(markup.match(/data-loading-segment=/g)).toHaveLength(8);
  });
});
