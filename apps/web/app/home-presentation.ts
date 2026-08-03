export type HomePresentation = {
  ctaHref: string | null;
  ctaLabel: "COMING SOON" | "START DRIVING";
  eyebrow: "PREVIEW / COMING SOON" | "LIVE / DIRECT";
  showLiveBadge: boolean;
};

export function getHomePresentation(mockMode: boolean): HomePresentation {
  if (mockMode) {
    return {
      ctaHref: null,
      ctaLabel: "COMING SOON",
      eyebrow: "PREVIEW / COMING SOON",
      showLiveBadge: false,
    };
  }

  return {
    ctaHref: "/preflight",
    ctaLabel: "START DRIVING",
    eyebrow: "LIVE / DIRECT",
    showLiveBadge: true,
  };
}

export function getViewerBadgeText(
  count: number | null,
  unavailable: boolean,
): string {
  if (unavailable) {
    return "AUDIENCE UNAVAILABLE";
  }

  return count === null ? "CHECKING AUDIENCE" : `${count} WATCHING NOW`;
}

export function getVideoStatusLabel(mockMode: boolean): "PREVIEW" | "● LIVE / DIRECT" {
  return mockMode ? "PREVIEW" : "● LIVE / DIRECT";
}
