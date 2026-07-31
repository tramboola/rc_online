import { expect, test } from "@playwright/test";

test("desktop interactions use short composited hover motion", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.goto("/");
  const callToAction = page.getByRole("link", { name: /start driving/i });
  await expect(callToAction).toBeVisible();

  const transition = await callToAction.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      durations: styles.transitionDuration
        .split(",")
        .map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1000)),
      properties: styles.transitionProperty.split(",").map((value) => value.trim()),
    };
  });

  expect(transition.properties).not.toContain("all");
  expect(transition.properties).toEqual(
    expect.arrayContaining(["border-color", "color", "transform"]),
  );
  expect(Math.max(...transition.durations)).toBeLessThanOrEqual(200);

  await callToAction.hover();
  await expect
    .poll(() =>
      callToAction.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe("none");

  const brand = page.getByRole("link", { name: "RC RACING" });
  const brandLockup = brand.locator(".brand-lockup");
  await brand.hover();
  await expect
    .poll(() =>
      brandLockup.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe("none");
  await expect
    .poll(() =>
      brand.locator("strong").evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe("none");

  const recordCard = page.locator(".record-card");
  const frameBefore = await recordCard.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--frame-color").trim(),
  );
  const frameGeometry = await recordCard.evaluate((element) =>
    getComputedStyle(element, "::before").backgroundSize,
  );
  expect(frameGeometry).toContain("9px 9px");

  await recordCard.hover();
  await expect
    .poll(() =>
      recordCard.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--frame-color").trim(),
      ),
    )
    .not.toBe(frameBefore);
});

test("reduced-motion removes decorative movement", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const callToAction = page.getByRole("link", { name: /start driving/i });
  await callToAction.hover();

  const motion = await callToAction.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      durations: styles.transitionDuration
        .split(",")
        .map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1000)),
      transform: styles.transform,
    };
  });

  expect(Math.max(...motion.durations)).toBeLessThanOrEqual(0.1);
  expect(motion.transform).toBe("none");
});

test("home record uses the cache-safe single contour track", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.goto("/");
  const track = page.getByRole("img", { name: "Neon Circuit track layout" });
  await expect(track).toHaveAttribute(
    "src",
    "/assets/neon-circuit-map-simple-v2.webp",
  );
  await expect
    .poll(() =>
      track.evaluate((element) => ({
        complete: (element as HTMLImageElement).complete,
        height: (element as HTMLImageElement).naturalHeight,
        width: (element as HTMLImageElement).naturalWidth,
      })),
    )
    .toEqual({ complete: true, height: 887, width: 1774 });
});
