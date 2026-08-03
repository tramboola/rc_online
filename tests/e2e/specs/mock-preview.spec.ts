import { expect, test } from "@playwright/test";

test("mock home is a coming-soon preview with a real audience count", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.goto("/");

  await expect(page.getByText("COMING SOON", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /start driving/i })).toHaveCount(0);
  await expect(page.locator(".live-badge")).toHaveCount(0);
  await expect(page.locator(".viewer-badge")).toHaveText(/^\d+ WATCHING NOW$/);

  const response = await page.request.post("/api/viewers", {
    data: { viewerId: "test_browser-two" },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { count: number };
  expect(body.count).toBeGreaterThanOrEqual(2);

  await page.goto("/ride");
  await expect(page.locator(".ride-brand b")).toHaveText("PREVIEW");
});
