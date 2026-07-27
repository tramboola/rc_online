import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const artifactRoot = resolve(
  import.meta.dirname,
  `../../../artifacts/visual-qa/${process.env.VISUAL_QA_PASS ?? "pass-1"}`,
);

const desktopScreens = [
  ["01-home-live-track", "/"],
  ["02-pricing-memberships", "/pricing"],
  ["03-season-leaderboard", "/leaderboard"],
  ["04-preflight-controls", "/preflight"],
  ["05-live-queue", "/queue"],
  ["07-ride-results", "/results"],
] as const;

async function capture(
  page: Page,
  name: string,
  route: string,
  consoleErrors: string[],
) {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toBeVisible();
  await page.screenshot({
    path: resolve(artifactRoot, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });

  const unexpected = consoleErrors.filter(
    (message) =>
      !message.includes("ERR_CONNECTION_REFUSED") &&
      !message.includes("Failed to fetch"),
  );
  expect(unexpected, `Unexpected console errors on ${route}`).toEqual([]);
}

test.beforeAll(async () => {
  await mkdir(artifactRoot, { recursive: true });
});

test("capture desktop reference states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const [name, route] of desktopScreens) {
    await capture(page, name, route, consoleErrors);
    consoleErrors.length = 0;
  }
});

test("capture wide driving state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "driving-wide");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await capture(page, "06-driving-interface", "/ride", consoleErrors);
});

test("capture mobile viewing and desktop-driving gate", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const [name, route] of [
    ["mobile-home", "/"],
    ["mobile-pricing", "/pricing"],
    ["mobile-leaderboard", "/leaderboard"],
    ["mobile-ride-gate", "/ride"],
  ] as const) {
    await capture(page, name, route, consoleErrors);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `No horizontal overflow on ${route}`,
    ).toBe(true);
    consoleErrors.length = 0;
  }
});
