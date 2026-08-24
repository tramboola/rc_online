import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "./layout";

const { navigationState } = vi.hoisted(() => ({
  navigationState: { pathname: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("../auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

async function renderLayout(pathname: string) {
  navigationState.pathname = pathname;
  const tree = await RootLayout({ children: <main>ROUTE CONTENT</main> });
  return renderToStaticMarkup(tree);
}

describe("root layout legal footer", () => {
  it.each(["/", "/auth/error"])("renders one shared footer on %s", async (pathname) => {
    const markup = await renderLayout(pathname);

    expect(markup).toContain("ROUTE CONTENT");
    expect(markup.match(/class="legal-footer"/g)).toHaveLength(1);
  });

  it("does not render the shared footer on the live ride route", async () => {
    const markup = await renderLayout("/ride");

    expect(markup).toContain("ROUTE CONTENT");
    expect(markup).not.toContain("legal-footer");
  });
});
