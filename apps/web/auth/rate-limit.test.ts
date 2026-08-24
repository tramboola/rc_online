import { describe, expect, test } from "vitest";

import { hashRateLimitKey } from "./rate-limit";

describe("rate-limit keys", () => {
  test("normalizes a kind:value input before HMACing it so equivalent account keys share a limit", () => {
    expect(hashRateLimitKey("server-secret", " sign_in:ALICE@Example.com ")).toBe(
      "6b96c4498a1ba1755befb1c53d5674bf55b6d118e2a9013ae4bfef7592f50842",
    );
  });

  test("uses the configured secret instead of producing one digest shared by every deployment", () => {
    expect(hashRateLimitKey("another-secret", "sign_in:alice@example.com")).toBe(
      "a18adef9dc7f4dea09286fb35776d47e9593e47f1462414bd38fe5027a35d36c",
    );
  });

  test("does not expose raw email or IP fragments in the persisted rate-limit digest", () => {
    const digest = hashRateLimitKey("server-secret", "sign_in:alice@example.com|203.0.113.7");

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("alice");
    expect(digest).not.toContain("203.0.113.7");
  });
});
