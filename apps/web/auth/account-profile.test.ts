import { describe, expect, test } from "vitest";

import {
  createDefaultNickname,
  defaultAvatarKey,
} from "./account-profile";

describe("account profile defaults", () => {
  test("derives a neutral nickname from the first eight UUID hex characters", () => {
    expect(
      createDefaultNickname("12ab34cd-5678-90ef-abcd-1234567890ef"),
    ).toBe("Driver-12AB34CD");
    expect(defaultAvatarKey).toBe("racer-red");
  });

  test("adds a deterministic numeric suffix for collision retries", () => {
    expect(
      createDefaultNickname("12ab34cd-5678-90ef-abcd-1234567890ef", 3),
    ).toBe("Driver-12AB34CD-3");
  });
});
