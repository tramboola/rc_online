import { describe, expect, test, vi } from "vitest";

import { createForgotPasswordPost } from "./route";

const origin = "https://rcmania.live";
const secret = "ab".repeat(32);

function request(body: unknown) {
  return new Request(`${origin}/api/account/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
    body: JSON.stringify(body),
  });
}

describe("forgot-password route", () => {
  test("returns an identical generic response for known and unknown emails", async () => {
    const known = createForgotPasswordPost({
      service: { requestPasswordReset: vi.fn(async () => ({ kind: "accepted" as const })) },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    });
    const unknown = createForgotPasswordPost({
      service: { requestPasswordReset: vi.fn(async () => ({ kind: "accepted" as const })) },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    });

    const knownResponse = await known(request({ email: "driver@example.com" }));
    const unknownResponse = await unknown(request({ email: "unknown@example.com" }));
    expect([knownResponse.status, await knownResponse.json()]).toEqual([202, {
      ok: true,
      message: "If this email can be used, check your inbox.",
    }]);
    expect([unknownResponse.status, await unknownResponse.json()]).toEqual([202, {
      ok: true,
      message: "If this email can be used, check your inbox.",
    }]);
  });

  test("stops an unbounded streamed body at the recovery size limit", async () => {
    const requestPasswordReset = vi.fn(async () => ({ kind: "accepted" as const }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"email":"${"x".repeat(4_096)}"}`));
        controller.close();
      },
    });
    const streamed = new Request(`${origin}/api/account/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
      body,
      duplex: "half",
    } as RequestInit);

    const response = await createForgotPasswordPost({
      service: { requestPasswordReset },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(streamed);
    expect(response.status).toBe(413);
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(streamed.body?.locked).toBe(false);
  });

  test("rejects a cross-origin recovery request before calling the service", async () => {
    const requestPasswordReset = vi.fn(async () => ({ kind: "accepted" as const }));
    const response = await createForgotPasswordPost({
      service: { requestPasswordReset },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
    })(new Request(`${origin}/api/account/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test", "x-real-ip": "203.0.113.24" },
      body: JSON.stringify({ email: "driver@example.com" }),
    }));
    expect(response.status).toBe(403);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});
