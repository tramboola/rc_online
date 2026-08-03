import { describe, expect, test } from "vitest";

import { hashSessionToken } from "./session-token";

describe("hashSessionToken", () => {
  test("returns a deterministic SHA-256 hex digest", () => {
    const digest = hashSessionToken("opaque-session-token");

    expect(digest).toBe(hashSessionToken("opaque-session-token"));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not return the raw token and separates different tokens", () => {
    expect(hashSessionToken("token-a")).not.toBe("token-a");
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });

  test("rejects an empty token", () => {
    expect(() => hashSessionToken("")).toThrow("Session token is required");
  });
});
