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

  it("renders phone preflight controls without a desktop-only gate", () => {
    const markup = renderToStaticMarkup(
      <SimulationScreen adminAccess mockMode screen="preflight" />,
    );

    expect(markup).toContain('class="mobile-preflight"');
    expect(markup).toContain("PHONE CONTROL CHECK");
    expect(markup).toContain("ENABLE TILT STEERING");
    expect(markup).toContain("Proportional throttle and reverse");
    expect(markup).not.toContain("Desktop required to drive");
  });

  it.each(["queue", "ride"] as const)(
    "allows the %s flow to render on mobile instead of showing a desktop gate",
    (screen) => {
      const markup = renderToStaticMarkup(
        <SimulationScreen adminAccess mockMode screen={screen} />,
      );

      expect(markup).not.toContain("Desktop required to drive");
    },
  );

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

  it("renders a waiting message when no car is available", () => {
    const markup = renderToStaticMarkup(
      <SimulationScreen
        adminAccess
        mockMode
        operationalStatus={{
          state: "ready",
          cars: [],
          queueCount: 0,
        }}
        screen="queue"
      />,
    );

    expect(markup).toContain("WAITING FOR AVAILABILITY");
    expect(markup).toContain("NO CAR IS READY YET");
    expect(markup).toContain("Stay in the queue. You can connect as soon as a car comes online.");
    expect(markup).not.toContain("YOUR CAR IS READY");
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
