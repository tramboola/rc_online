import type { ViewerSocketStatus } from "./viewer-socket-client";

export type HomePresentation = {
  ctaAction: "disabled" | "navigate" | "sign-in";
  ctaHref: string | null;
  ctaLabel: "COMING SOON" | "SIGN IN TO DRIVE" | "START DRIVING";
  eyebrow: "PREVIEW / COMING SOON" | "LIVE / DIRECT";
  showLiveBadge: boolean;
};

export function getHomePresentation(
  mockMode: boolean,
  adminAccess = false,
  signedIn = false,
): HomePresentation {
  if (!signedIn && !adminAccess) {
    return {
      ctaAction: "sign-in",
      ctaHref: null,
      ctaLabel: "SIGN IN TO DRIVE",
      eyebrow: mockMode ? "PREVIEW / COMING SOON" : "LIVE / DIRECT",
      showLiveBadge: !mockMode,
    };
  }

  if (mockMode && !adminAccess) {
    return {
      ctaAction: "disabled",
      ctaHref: null,
      ctaLabel: "COMING SOON",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    };
  }

  if (mockMode) {
    return {
      ctaAction: "navigate",
      ctaHref: "/preflight",
      ctaLabel: "START DRIVING",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    };
  }

  return {
    ctaAction: "navigate",
    ctaHref: "/preflight",
    ctaLabel: "START DRIVING",
    eyebrow: "LIVE / DIRECT",
    showLiveBadge: true,
  };
}

export function getViewerBadgeText(
  count: number | null,
  status: ViewerSocketStatus,
): string {
  if (status === "live" && count !== null && Number.isInteger(count) && count >= 0) {
    return `${count} WATCHING NOW`;
  }

  return "â€” VIEWING NOW";
}

export function getVideoStatusLabel(mockMode: boolean): "PREVIEW" | "● LIVE / DIRECT" {
  return mockMode ? "PREVIEW" : "● LIVE / DIRECT";
}
