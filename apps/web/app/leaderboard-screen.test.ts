import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, test, vi } from "vitest";

import { SimulationScreen } from "./simulation-screen";

vi.mock("./account-control", () => ({
  AccountControl: () => null,
}));

function renderMockLeaderboard(): string {
  return renderToStaticMarkup(createElement(SimulationScreen, {
    mockMode: true,
    screen: "leaderboard",
  }));
}

describe("leaderboard screen", () => {
  test("renders honest mock content without premature season actions", () => {
    const html = renderMockLeaderboard();

    expect(html).toContain("SEASON HASN&#x27;T STARTED YET");
    expect(html).toContain("COMING SOON");
    expect(html).not.toContain("NIGHTSHIFT");
    expect(html).not.toContain("PAST SEASONS");
  });

  test("renders View Rules as a link to How It Works", () => {
    const html = renderMockLeaderboard();

    expect(html).toMatch(
      /<a[^>]*href="\/how-it-works"[^>]*>.*VIEW RULES.*<\/a>/su,
    );
  });
});
