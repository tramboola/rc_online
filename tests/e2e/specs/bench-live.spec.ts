import { expect, test } from "@playwright/test";

test.describe("RC Bench Level 2", () => {
  test("arms explicitly, reflects keyboard input, and disarms on blur", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "The live bench intentionally accepts only one desktop keyboard owner.",
    );
    await page.goto("/?token=test-token");

    await expect(page).toHaveTitle("RC Bench Level 2");
    await expect(page.getByRole("heading", { name: "Live keyboard control" })).toBeVisible();
    await expect(page.getByTestId("arm-state")).toHaveText("DISARMED");

    await page.getByRole("button", { name: "Arm keyboard" }).click();
    await expect(page.getByTestId("arm-state")).toHaveText("ARMED");

    await page.keyboard.down("KeyA");
    await expect(page.getByTestId("steering-state")).toContainText("LEFT");
    await expect(page.locator('[data-key="A"]')).toHaveAttribute("data-active", "true");
    await page.keyboard.up("KeyA");
    await expect(page.getByTestId("steering-state")).toContainText("CENTER");

    await page.keyboard.down("KeyW");
    await expect(page.getByTestId("throttle-state")).toContainText("FORWARD");
    await page.keyboard.up("KeyW");
    await expect(page.getByTestId("throttle-state")).toContainText("NEUTRAL");

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByTestId("arm-state")).toHaveText("DISARMED");
  });
});
