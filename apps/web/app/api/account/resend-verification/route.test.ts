import { describe, expect, test, vi } from "vitest";

import { createResendVerificationPost } from "./route";

const origin = "https://rcmania.live";
const secret = "cd".repeat(32);

function request(body: unknown) {
  return new Request(`${origin}/api/account/resend-verification`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
    body: JSON.stringify(body),
  });
}

describe("verification resend route", () => {
  test("returns the same accepted response for every eligible or ineligible email", async () => {
    const resendVerification = vi.fn(async () => ({ kind: "accepted" as const }));
    const response = await createResendVerificationPost({
      service: { resendVerification },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(request({ email: " Driver@Example.COM " }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: "If this email can be used, check your inbox." });
    expect(resendVerification).toHaveBeenCalledWith(expect.objectContaining({
      email: "driver@example.com",
      ipKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accountKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  test("rejects extra fields and maps rate denial without a cookie", async () => {
    const resendVerification = vi.fn(async () => ({ kind: "accepted" as const }));
    const post = createResendVerificationPost({ service: { resendVerification }, canonicalOrigin: origin, rateLimitSecret: secret });
    expect((await post(request({ email: "driver@example.com", userId: "11111111-2222-4333-8444-555555555555" }))).status).toBe(400);
    const limited = await createResendVerificationPost({
      service: { resendVerification: async () => ({ kind: "rate_limited" }) },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(request({ email: "driver@example.com" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.has("set-cookie")).toBe(false);
  });
});
