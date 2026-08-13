import { describe, expect, test } from "vitest";

import { canAccessScreen } from "./screen-access";

describe("canAccessScreen", () => {
  test.each(["preflight", "queue", "ride", "results", "operator"] as const)(
    "blocks a regular user from %s while the public site is in preview",
    (screen) => {
      expect(canAccessScreen(screen, true, "user")).toBe(false);
    },
  );

  test("allows an administrator into the standard preflight flow", () => {
    expect(canAccessScreen("preflight", true, "admin")).toBe(true);
  });

  test("keeps public preview pages accessible", () => {
    expect(canAccessScreen("pricing", true, "user")).toBe(true);
  });

  test("does not apply the preview gate after launch", () => {
    expect(canAccessScreen("ride", false, "user")).toBe(true);
  });
});
