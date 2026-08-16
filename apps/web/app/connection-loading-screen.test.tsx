import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConnectionLoadingScreen,
  getActiveLoadingSegments,
  getConnectionUrl,
} from "./connection-loading-screen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("demo=1"),
}));

describe("connection loading screen", () => {
  it("moves exactly two adjacent segments across the loading rail", () => {
    expect(getActiveLoadingSegments(0)).toEqual([0, 1]);
    expect(getActiveLoadingSegments(6)).toEqual([6, 7]);
    expect(getActiveLoadingSegments(7)).toEqual([0, 1]);
    expect(getActiveLoadingSegments(-1)).toEqual([6, 7]);
  });

  it("builds an encoded connection route for the selected car", () => {
    expect(getConnectionUrl("car id/01")).toBe(
      "/loading?car=car%20id%2F01",
    );
  });

  it("renders the reference loading structure with one active pair", () => {
    const markup = renderToStaticMarkup(
      <ConnectionLoadingScreen
        adminAccess={false}
        mockMode
        operationalStatus={undefined}
      />,
    );

    expect(markup).toContain("CONNECTING TO CAR");
    expect(markup).toContain("SYSTEM LOG");
    expect(markup.match(/data-loading-segment=/g)).toHaveLength(8);
    expect(markup.match(/is-active/g)).toHaveLength(2);
    expect(markup).toContain("Boot sequence started");
  });
});
