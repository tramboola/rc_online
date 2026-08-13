import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, test, vi } from "vitest";

import type { OperationalStatus } from "./operational-status";
import { SimulationScreen } from "./simulation-screen";

vi.mock("./account-control", () => ({
  AccountControl: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {} }),
}));

const emptyOperationalStatus: OperationalStatus = {
  state: "ready",
  cars: [],
  queueCount: 0,
};

function renderAdministratorScreen(screen: "home" | "queue"): string {
  return renderToStaticMarkup(createElement(SimulationScreen, {
    adminAccess: true,
    mockMode: true,
    operationalStatus: emptyOperationalStatus,
    screen,
  }));
}

describe("administrator live access", () => {
  test("links the preview home CTA to the standard preflight flow", () => {
    const html = renderAdministratorScreen("home");

    expect(html).toMatch(
      /<a[^>]*class="hero-link"[^>]*href="\/preflight"[^>]*>.*START DRIVING.*<\/a>/su,
    );
    expect(html).toContain("PREVIEW / COMING SOON");
    expect(html).not.toContain("● LIVE");
  });

  test("renders the real empty fleet instead of fictional available cars", () => {
    const html = renderAdministratorScreen("home");

    expect(html).toMatch(/<strong>0<\/strong><small>CARS AVAILABLE<\/small>/u);
  });

  test("does not offer fictional cars when the production fleet is empty", () => {
    const html = renderAdministratorScreen("queue");

    expect(html).toContain("NO CARS AVAILABLE");
    expect(html).not.toContain("NIGHT RUNNER");
    expect(html).not.toContain("RED COMET");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*ACCEPT &amp; CONNECT.*<\/button>/su);
  });
});
