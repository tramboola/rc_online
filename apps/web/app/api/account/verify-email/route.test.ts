import { describe, expect, test, vi } from "vitest";

import { createVerifyEmailPost } from "./route";

const origin = "https://rcmania.live";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/account/verify-email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin, "x-real-ip": "203.0.113.24" },
    body: JSON.stringify(body),
  });
}

describe("email verification route", () => {
  test("consumes one bounded token without echoing it or private account fields", async () => {
    const verifyEmail = vi.fn(async () => ({ kind: "verified" as const }));
    const token = "a".repeat(43);
    const response = await createVerifyEmailPost({ service: { verifyEmail }, canonicalOrigin: origin })(request({ token }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true, message: "Email verified." });
    expect(text).not.toContain(token);
    expect(text).not.toContain("userId");
    expect(verifyEmail).toHaveBeenCalledWith({ token });
  });

  test("uses one invalid response for expired, replayed, or wrong-purpose tokens", async () => {
    const response = await createVerifyEmailPost({
      service: { verifyEmail: async () => ({ kind: "invalid" }) },
      canonicalOrigin: origin,
    })(request({ token: "b".repeat(43) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Verification link is invalid or expired." });
  });

  test("rejects malformed, over-posted, and cross-origin requests", async () => {
    const verifyEmail = vi.fn(async () => ({ kind: "verified" as const }));
    const post = createVerifyEmailPost({ service: { verifyEmail }, canonicalOrigin: origin });
    expect((await post(request({ token: "short" }))).status).toBe(400);
    expect((await post(request({ token: "a".repeat(43), email: "driver@example.com" }))).status).toBe(400);
    expect((await post(request({ token: "a".repeat(43) }, "https://evil.test"))).status).toBe(403);
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
