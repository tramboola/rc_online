// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { SimulationScreen } from "./simulation-screen";

const styles = readFileSync("app/styles.css", "utf8");

vi.mock("next/navigation", () => ({
  usePathname: () => "/queue",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

it("uses the available status color for the queue car connection icon", () => {
  const markup = renderToStaticMarkup(
    <SimulationScreen
      adminAccess
      liveQueueSnapshot={{
        entryId: "queue-entry-1",
        position: 1,
        count: 1,
        availableCarCount: 1,
        status: "ready",
        cars: [{
          id: "40000000-0000-4000-8000-000000000001",
          name: "RC Mania One",
          slug: "rc-mania-one",
          batteryPercent: 53,
          availability: "available",
        }],
      }}
      mockMode
      screen="queue"
    />,
  );
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.innerHTML = markup;
  const icon = document.querySelector(".car-choice .connection-available svg");

  expect(icon).not.toBeNull();
  expect(getComputedStyle(icon!).color).toBe("var(--lime)");
}, 15_000);
