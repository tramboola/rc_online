import { expect, test } from "@playwright/test";

test("desktop user can reach the driving result path", async ({ page }) => {
  test.skip(
    test.info().project.name.includes("mobile"),
    "desktop driving contract",
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /drive it for real/i })).toBeVisible();
  await page.getByRole("link", { name: /start driving/i }).click();
  await expect(page).toHaveURL(/preflight/);
  await page.getByRole("button", { name: /retest/i }).click();
  await page.getByRole("button", { name: /continue to queue/i }).click();
  await expect(page).toHaveURL(/queue/);
  await page.getByRole("button", { name: /accept & connect/i }).click();
  await expect(page).toHaveURL(/ride/);
  await page.getByRole("button", { name: /^end ride$/i }).click();
  await expect(page).toHaveURL(/results/);
  await expect(page.getByRole("heading", { name: /ride complete/i })).toBeVisible();
});

test("mobile blocks driving controls while preserving public viewing", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only contract");
  await page.goto("/ride");
  await expect(page.getByText(/desktop required/i)).toBeVisible();
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: /neon circuit/i })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("pricing, preflight, and queue controls expose their selected states", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop interaction contract");

  await page.goto("/pricing");
  await page.getByLabel("CREATOR CODE").fill("GRID10");
  await page.getByRole("button", { name: /^apply/i }).click();
  await expect(page.getByText(/creator code applied/i)).toBeVisible();

  await page.goto("/preflight");
  await page.getByRole("button", { name: /keyboard/i }).click();
  await expect(page.getByRole("button", { name: /keyboard/i })).toHaveClass(/selected/);
  await page.getByRole("button", { name: /aggressive/i }).click();
  await expect(page.getByRole("button", { name: /aggressive/i })).toHaveClass(/selected/);

  await page.goto("/queue");
  await page.getByRole("button", { name: /red comet rc car/i }).click();
  await expect(page.getByRole("button", { name: /red comet rc car/i })).toHaveClass(
    /selected/,
  );
});
