import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LegalFooter } from "./legal-footer";
import { SimulationScreen } from "./simulation-screen";

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

describe("legal footer", () => {
  it("renders privacy, terms, then the safely linked Instagram control", () => {
    const markup = renderToStaticMarkup(<LegalFooter />);
    const privacy = markup.indexOf("PRIVACY");
    const terms = markup.indexOf("TERMS");
    const instagram = markup.indexOf("RC Mania on Instagram");

    expect(privacy).toBeGreaterThan(-1);
    expect(terms).toBeGreaterThan(privacy);
    expect(instagram).toBeGreaterThan(terms);
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/terms"');
    expect(markup).toContain('href="https://www.instagram.com/rcmania.live/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('aria-label="RC Mania on Instagram"');
  });

  it("is available on ordinary screens but never overlays the live ride view", () => {
    expect(renderToStaticMarkup(<SimulationScreen screen="home" />)).toContain("legal-footer");
    expect(renderToStaticMarkup(<SimulationScreen screen="ride" />)).not.toContain("legal-footer");
  });
});
