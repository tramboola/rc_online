import { describe, expect, test, vi } from "vitest";

import { createPasswordSignInPost } from "./route";

const origin = "https://rcmania.live";
const secret = "ef".repeat(32);
const expiresAt = new Date("2026-08-31T12:00:00.000Z");

function request(body: unknown) {
  return new Request(`${origin}/api/account/sign-in/password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
    body: JSON.stringify(body),
  });
}

const productionCookie = (token: string, expires: Date) => ({
  name: "__Secure-authjs.session-token" as const,
  value: token,
  options: {
    httpOnly: true as const,
    secure: true,
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: 604_800,
    expires,
  },
});

describe("password sign-in route", () => {
  test("returns one generic 401 without Set-Cookie for every authentication failure", async () => {
    const signInPassword = vi.fn(async () => ({ kind: "invalid" as const }));
    const response = await createPasswordSignInPost({
      service: { signInPassword },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
      createSessionCookie: productionCookie,
    })(request({ email: " Unknown@Example.com ", password: "correct horse battery" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, message: "Unable to sign in." });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(signInPassword).toHaveBeenCalledWith(expect.objectContaining({
      email: "unknown@example.com",
      ipKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accountKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  test("sets one host-only secure Auth.js database-session cookie after success", async () => {
    const response = await createPasswordSignInPost({
      service: { signInPassword: async () => ({ kind: "authenticated", token: "raw-session-token", expiresAt }) },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
      createSessionCookie: productionCookie,
    })(request({ email: "driver@example.com", password: "correct horse battery" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Signed in." });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("__Secure-authjs.session-token=raw-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  test("rejects over-posting and never sets a cookie for rate denial", async () => {
    const signInPassword = vi.fn(async () => ({ kind: "invalid" as const }));
    const post = createPasswordSignInPost({ service: { signInPassword }, canonicalOrigin: origin, rateLimitSecret: secret, createSessionCookie: productionCookie });
    expect((await post(request({ email: "driver@example.com", password: "correct horse battery", userId: "11111111-2222-4333-8444-555555555555" }))).status).toBe(400);
    const limited = await createPasswordSignInPost({
      service: { signInPassword: async () => ({ kind: "rate_limited" }) },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
      createSessionCookie: productionCookie,
    })(request({ email: "driver@example.com", password: "correct horse battery" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.has("set-cookie")).toBe(false);
  });
});
