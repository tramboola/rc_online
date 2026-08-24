import { describe, expect, test } from "vitest";

import {
  getHomePresentation,
  getVideoStatusLabel,
  getViewerBadgeText,
} from "./home-presentation";

describe("getHomePresentation", () => {
  test("invites a signed-out visitor to authenticate before driving", () => {
    expect(getHomePresentation(true, false, false)).toEqual({
      ctaAction: "sign-in",
      ctaHref: null,
      ctaLabel: "SIGN IN TO DRIVE",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    });
  });

  test("keeps coming soon for a signed-in non-admin during preview", () => {
    expect(getHomePresentation(true, false, true)).toEqual({
      ctaAction: "disabled",
      ctaHref: null,
      ctaLabel: "COMING SOON",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    });
  });

  test("keeps the live start-driving presentation for a signed-in user outside mock mode", () => {
    expect(getHomePresentation(false, false, true)).toEqual({
      ctaAction: "navigate",
      ctaHref: "/preflight",
      ctaLabel: "START DRIVING",
      eyebrow: "LIVE / DIRECT",
      showLiveBadge: true,
    });
  });

  test("opens preflight for an administrator without relabeling preview video as live", () => {
    expect(getHomePresentation(true, true)).toEqual({
      ctaAction: "navigate",
      ctaHref: "/preflight",
      ctaLabel: "START DRIVING",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    });
  });
});

describe("getViewerBadgeText", () => {
  test("formats a real active viewer count", () => {
    expect(getViewerBadgeText(3, "live")).toBe("3 WATCHING NOW");
  });

  test("does not invent a count while the socket is connecting", () => {
    expect(getViewerBadgeText(null, "connecting")).toBe("â€” VIEWING NOW");
  });

  test("does not invent a count when the socket is unavailable", () => {
    expect(getViewerBadgeText(null, "unavailable")).toBe("â€” VIEWING NOW");
  });
});

test("mock video status is a preview rather than live", () => {
  expect(getVideoStatusLabel(true)).toBe("PREVIEW");
  expect(getVideoStatusLabel(false)).toBe("● LIVE / DIRECT");
});
