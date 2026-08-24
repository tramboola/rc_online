import { describe, expect, test, vi } from "vitest";

import { createAccountDeleteRoute } from "./route";

const origin = "https://rcmania.live";
const subject = "11111111-2222-4333-8444-555555555555";
const secret = "ef".repeat(32);

const productionClearedCookie = () => ({
  name: "__Secure-authjs.session-token" as const,
  value: "" as const,
  options: {
    httpOnly: true as const,
    secure: true,
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: 0 as const,
    expires: new Date(0),
  },
});

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`${origin}/api/account/delete`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin,
      "x-real-ip": "203.0.113.24",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function route(overrides: Partial<Parameters<typeof createAccountDeleteRoute>[0]> = {}) {
  const deleteAccount = vi.fn(async () => ({ kind: "deleted" as const }));
  return {
    deleteAccount,
    handler: createAccountDeleteRoute({
      service: { deleteAccount },
      canonicalOrigin: origin,
      rateLimitSecret: secret,
      getSubject: async () => subject,
      createClearedSessionCookie: productionClearedCookie,
      ...overrides,
    }),
  };
}

describe("self-service account deletion route", () => {
  test("deletes only the authenticated subject, returns no private data, and clears the production cookie", async () => {
    const { handler, deleteAccount } = route();
    const response = await handler(request({ confirmation: "DELETE" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, message: "Account deleted." });
    expect(deleteAccount).toHaveBeenCalledWith({
      authenticatedSubject: subject,
      ipKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accountKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("__Secure-authjs.session-token=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  test("returns a private 401 and never invokes deletion without an authenticated session", async () => {
    const { handler, deleteAccount } = route({ getSubject: async () => null });
    const response = await handler(new Request(`${origin}/api/account/delete`, {
      method: "DELETE",
      headers: { origin },
      body: "not parsed for signed-out requests",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: false, message: "Sign in required." });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  test.each(["delete", "DELETE ", " Delete", ""])(
    "requires the exact destructive confirmation %#",
    async (confirmation) => {
      const { handler, deleteAccount } = route();
      const response = await handler(request({ confirmation }));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(deleteAccount).not.toHaveBeenCalled();
    },
  );

  test("rejects cross-user addressing and every unknown field", async () => {
    const { handler, deleteAccount } = route();
    const response = await handler(request({
      confirmation: "DELETE",
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }));
    expect(response.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test("requires same-origin bounded JSON before calling the service", async () => {
    const { handler, deleteAccount } = route();
    const crossOrigin = await handler(request(
      { confirmation: "DELETE" },
      { origin: "https://evil.example" },
    ));
    const nonJson = await handler(new Request(`${origin}/api/account/delete`, {
      method: "DELETE",
      headers: { origin, "x-real-ip": "203.0.113.24" },
      body: "confirmation=DELETE",
    }));
    const oversized = await handler(request(
      { confirmation: "DELETE" },
      { "content-length": "4097" },
    ));

    expect([crossOrigin.status, nonJson.status, oversized.status]).toEqual([403, 415, 413]);
    for (const response of [crossOrigin, nonJson, oversized]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test("returns generic private errors, never clears the cookie on failure, and leaks no identifiers", async () => {
    for (const kind of ["rate_limited", "unavailable"] as const) {
      const { handler } = route({
        service: { deleteAccount: vi.fn(async () => ({ kind })) },
      });
      const response = await handler(request({ confirmation: "DELETE" }));
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(kind === "rate_limited" ? 429 : 503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(serialized).not.toMatch(/driver|email|userId|11111111|token/iu);
    }
  });

  test("contains session, service, and cookie failures behind one private generic response", async () => {
    const cases = [
      route({ getSubject: async () => { throw new Error("private session token"); } }).handler,
      route({ service: { deleteAccount: vi.fn(async () => { throw new Error("private email"); }) } }).handler,
      route({ createClearedSessionCookie: () => { throw new Error("private cookie"); } }).handler,
    ];
    for (const handler of cases) {
      const response = await handler(request({ confirmation: "DELETE" }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        ok: false,
        message: "Account deletion unavailable.",
      });
    }
  });
});
