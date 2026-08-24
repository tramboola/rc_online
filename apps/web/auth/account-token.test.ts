import { describe, expect, test } from "vitest";

import { createAccountToken, hashAccountToken } from "./account-token";

describe("account tokens", () => {
  test("creates distinct 32-byte URL-safe account tokens instead of reusing a predictable token", () => {
    const first = createAccountToken();
    const second = createAccountToken();

    expect(first.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.raw).not.toBe(second.raw);
  });

  test("returns a 64-character persisted digest instead of exposing the raw account token as storage data", () => {
    const token = createAccountToken();

    expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.hash).not.toBe(token.raw);
  });

  test("derives SHA-256 rather than an incompatible digest for a fixed account token", () => {
    expect(hashAccountToken("fixed-token")).toBe(
      "648f312cf893d191028cba09f60f8ffe95624c9ef2d40a0c2f0db0e356e37e0f",
    );
  });
});
