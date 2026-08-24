import { describe, expect, test, vi } from "vitest";

import { createRegisterPost } from "./route";

const canonicalOrigin = "https://rcmania.live";
const rateLimitSecret = "ab".repeat(32);

function request(body: unknown, options: {
  origin?: string;
  contentType?: string;
  realIp?: string;
  forwardedFor?: string;
} = {}) {
  return new Request(`${canonicalOrigin}/api/account/register`, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? canonicalOrigin,
      "x-real-ip": options.realIp ?? "203.0.113.24",
      ...(options.forwardedFor ? { "x-forwarded-for": options.forwardedFor } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("password account registration route", () => {
  test("normalizes input, replaces raw rate-limit identifiers with HMACs, and returns one accepted body", async () => {
    const register = vi.fn(async (_input: {
      email: string;
      password: string;
      legalRevision: string;
      ipKeyHash: string;
      accountKeyHash: string;
    }) => ({ kind: "accepted" as const }));
    const response = await createRegisterPost({
      service: { register },
      canonicalOrigin,
      rateLimitSecret,
      legalRevision: "2026-08-24",
    })(request({
      email: " Driver@Example.COM ",
      password: "correct horse battery",
    }, { forwardedFor: "198.51.100.1, 10.0.0.2" }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      message: "If this email can be used, check your inbox.",
    });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      email: "driver@example.com",
      password: "correct horse battery",
      legalRevision: "2026-08-24",
      ipKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accountKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    const input = register.mock.calls[0]![0];
    expect(input.ipKeyHash).not.toContain("203.0.113.24");
    expect(input.ipKeyHash).not.toContain("198.51.100.1");
    expect(input.accountKeyHash).not.toContain("driver@example.com");
  });

  test.each([
    [{ email: "bad", password: "correct horse battery" }],
    [{ email: "driver@example.com", password: "too short" }],
    [{ email: "driver@example.com", password: "x".repeat(129) }],
    [{ email: "driver@example.com", password: "correct horse battery", userId: "11111111-2222-4333-8444-555555555555" }],
  ])("rejects malformed or over-posted JSON without calling the service", async (body) => {
    const register = vi.fn(async () => ({ kind: "accepted" as const }));
    const response = await createRegisterPost({ service: { register }, canonicalOrigin, rateLimitSecret, legalRevision: "2026-08-24" })(request(body));
    expect(response.status).toBe(400);
    expect(register).not.toHaveBeenCalled();
  });

  test("rejects non-JSON, cross-origin, missing trusted IP, and oversized bodies", async () => {
    const register = vi.fn(async () => ({ kind: "accepted" as const }));
    const post = createRegisterPost({ service: { register }, canonicalOrigin, rateLimitSecret, legalRevision: "2026-08-24" });
    expect((await post(request("plain text", { contentType: "text/plain" }))).status).toBe(415);
    expect((await post(request({ email: "driver@example.com", password: "correct horse battery" }, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await post(new Request(`${canonicalOrigin}/api/account/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: canonicalOrigin },
      body: JSON.stringify({ email: "driver@example.com", password: "correct horse battery" }),
    }))).status).toBe(400);
    expect((await post(request(JSON.stringify({ email: "driver@example.com", password: "x".repeat(5_000) })))).status).toBe(413);
    expect(register).not.toHaveBeenCalled();
  });

  test("maps either saturated key to one generic rate-limit response", async () => {
    const response = await createRegisterPost({
      service: { register: async () => ({ kind: "rate_limited" }) },
      canonicalOrigin,
      rateLimitSecret,
      legalRevision: "2026-08-24",
    })(request({ email: "driver@example.com", password: "correct horse battery" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, message: "Too many attempts. Try again later." });
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
