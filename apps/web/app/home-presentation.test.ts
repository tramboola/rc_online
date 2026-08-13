import { describe, expect, test } from "vitest";

import {
  getHomePresentation,
  getVideoStatusLabel,
  getViewerBadgeText,
} from "./home-presentation";

describe("getHomePresentation", () => {
  test("presents mock mode as a coming-soon preview", () => {
    expect(getHomePresentation(true)).toEqual({
      ctaHref: null,
      ctaLabel: "COMING SOON",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    });
  });

  test("keeps the live start-driving presentation outside mock mode", () => {
    expect(getHomePresentation(false)).toEqual({
      ctaHref: "/preflight",
      ctaLabel: "START DRIVING",
      eyebrow: "LIVE / DIRECT",
      showLiveBadge: true,
    });
  });

  test("opens preflight for an administrator without relabeling preview video as live", () => {
    expect(getHomePresentation(true, true)).toEqual({
      ctaHref: "/preflight",
      ctaLabel: "START DRIVING",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    });
  });
});

describe("getViewerBadgeText", () => {
  test("formats a real active viewer count", () => {
    expect(getViewerBadgeText(3, false)).toBe("3 WATCHING NOW");
  });

  test("shows a transient label before the first heartbeat completes", () => {
    expect(getViewerBadgeText(null, false)).toBe("CHECKING AUDIENCE");
  });

  test("does not invent a number when the endpoint is unavailable", () => {
    expect(getViewerBadgeText(null, true)).toBe("AUDIENCE UNAVAILABLE");
  });
});

test("mock video status is a preview rather than live", () => {
  expect(getVideoStatusLabel(true)).toBe("PREVIEW");
  expect(getVideoStatusLabel(false)).toBe("● LIVE / DIRECT");
});
