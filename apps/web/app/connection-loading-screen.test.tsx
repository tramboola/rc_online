import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConnectionLoadingOverlay,
  ConnectionLoadingScreen,
  getActiveLoadingSegments,
  getConnectionUrl,
  getRideUrl,
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

  it("builds a direct ride route for the selected real car", () => {
    expect(getRideUrl("car id/01")).toBe("/ride?car=car%20id%2F01");
  });

  it("renders controlled connected state without failure actions", () => {
    const markup = renderToStaticMarkup(
      <ConnectionLoadingOverlay
        activeStep={4}
        entries={[{ time: "10:00:00", code: "VIDEO", message: "First frame decoded" }]}
        errorMessage=""
        onRetry={() => undefined}
        onReturn={() => undefined}
        status="connected"
      />,
    );

    expect(markup).toContain("CONNECTED");
    expect(markup).toContain("First frame decoded");
    expect(markup).not.toContain("RETRY CONNECTION");
    expect(markup).not.toContain("RETURN TO QUEUE");
  });

  it("keeps failed connection visible with retry and return actions", () => {
    const markup = renderToStaticMarkup(
      <ConnectionLoadingOverlay
        activeStep={3}
        entries={[{ time: "10:00:00", code: "ERROR", message: "Camera connection timed out", tone: "danger" }]}
        errorMessage="Camera connection timed out"
        onRetry={() => undefined}
        onReturn={() => undefined}
        status="failed"
      />,
    );

    expect(markup).toContain("CONNECTION FAILED");
    expect(markup).toContain("Camera connection timed out");
    expect(markup).toContain("RETRY CONNECTION");
    expect(markup).toContain("RETURN TO QUEUE");
  });
});
