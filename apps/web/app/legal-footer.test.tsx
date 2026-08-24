import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LegalFooter } from "./legal-footer";

const { navigationState } = vi.hoisted(() => ({
  navigationState: { pathname: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("demo=1"),
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

  it.each(["/", "/privacy", "/terms", "/auth/error", "/ride-history"])(
    "renders through the shared route-aware footer on %s",
    (pathname) => {
      navigationState.pathname = pathname;
      expect(renderToStaticMarkup(<LegalFooter />)).toContain("legal-footer");
    },
  );

  it("omits the footer only from the live ride path", () => {
    navigationState.pathname = "/ride";
    expect(renderToStaticMarkup(<LegalFooter />)).toBe("");
  });

  it("keeps accessible link names and a compact mobile layout contract", () => {
    navigationState.pathname = "/";
    const markup = renderToStaticMarkup(<LegalFooter />);
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(markup).toContain('<nav aria-label="Legal and social links">');
    expect(markup).toContain('aria-label="RC Mania on Instagram"');
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.legal-footer \{[^}]*padding: 14px 16px;/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.legal-footer nav \{[^}]*gap: 18px;/);
  });
});
