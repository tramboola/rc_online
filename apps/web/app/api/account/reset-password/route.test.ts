import { describe, expect, test, vi } from "vitest";

import { createResetPasswordPost } from "./route";

const origin = "https://rcmania.live";
const secret = "cd".repeat(32);
const token = "A".repeat(43);

function request(body: unknown) {
  return new Request(`${origin}/api/account/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
    body: JSON.stringify(body),
  });
}

describe("reset-password route", () => {
  test("passes a purpose-bound reset token only with HMAC rate-limit keys", async () => {
    const resetPassword = vi.fn(async () => ({ kind: "reset" as const }));
    const response = await createResetPasswordPost({
      service: { resetPassword },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(request({ token, password: "new correct horse battery" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Password updated." });
    expect(resetPassword).toHaveBeenCalledWith(expect.objectContaining({
      token,
      password: "new correct horse battery",
      ipKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accountKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(JSON.stringify(resetPassword.mock.calls)).not.toContain("203.0.113.24");
  });

  test.each([
    { token, password: "too short" },
    { token, password: "x".repeat(129) },
    { token: "wrong-purpose-token", password: "new correct horse battery" },
    { token, password: "new correct horse battery", userId: "11111111-2222-4333-8444-555555555555" },
  ])("rejects malformed, over-posted, or policy-violating input", async (body) => {
    const resetPassword = vi.fn(async () => ({ kind: "reset" as const }));
    const response = await createResetPasswordPost({
      service: { resetPassword },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(request(body));
    expect(response.status).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
