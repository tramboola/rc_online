import { describe, expect, test } from "vitest";

import { normalizeUserRole } from "./user-role";

describe("normalizeUserRole", () => {
  test("preserves administrator access", () => {
    expect(normalizeUserRole("admin")).toBe("admin");
  });

  test.each(["user", "operator", "", null, undefined])(
    "fails closed for %s",
    (value) => {
      expect(normalizeUserRole(value)).toBe("user");
    },
  );
});
