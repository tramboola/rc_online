import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, test, vi } from "vitest";

import { SimulationScreen } from "./simulation-screen";

vi.mock("./account-control", () => ({
  AccountControl: () => null,
}));

describe("home season challenge", () => {
  test("explains that the season-ending fastest lap wins the prize", () => {
    const html = renderToStaticMarkup(createElement(SimulationScreen, {
      mockMode: true,
      screen: "home",
    }));

    expect(html).toContain("SEASON CHALLENGE");
    expect(html).toContain("BEAT THE TRACK RECORD");
    expect(html).toContain("Finish the season with the fastest lap. Win.");
    expect(html).not.toContain("Upload. Compete. Win.");
  });
});
