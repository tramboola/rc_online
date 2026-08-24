import { describe, expect, test } from "vitest";

import type { OwnProfile, RateLimitAttempt } from "../../../../auth/account-store";
import { createAccountProfileRoute, GET as productionGet } from "./route";

const subject = "11111111-2222-4333-8444-555555555555";
const ownProfile: OwnProfile = {
  email: "driver@example.com",
  nickname: "Driver One",
  avatarKey: "racer-red",
};

function createRoute(overrides: Partial<Parameters<typeof createAccountProfileRoute>[0]> = {}) {
  const calls: { subject?: string; profile?: Pick<OwnProfile, "nickname" | "avatarKey">; rateLimit?: unknown } = {};
  const route = createAccountProfileRoute({
    getSubject: async () => subject,
    getOwnProfile: async () => ownProfile,
    updateOwnProfile: async (receivedSubject, profile) => {
      calls.subject = receivedSubject;
      calls.profile = profile;
      return { ...ownProfile, ...profile };
    },
    takeRateLimitAttempt: async (attempt) => {
      calls.rateLimit = attempt;
      return { allowed: true, remaining: 4, retryAfterMs: 0 } satisfies RateLimitAttempt;
    },
    rateLimitSecret: "ab".repeat(32),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    ...overrides,
  });
  return { route, calls };
}

function patchRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://rcmania.live/api/account/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://rcmania.live", ...headers },
    body: JSON.stringify(body),
  });
}

describe("private account profile endpoint", () => {
  test("returns only the authenticated subject's explicit profile allowlist with private no-store caching", async () => {
    const { route } = createRoute();
    const response = await route.GET(new Request("https://rcmania.live/api/account/profile"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      email: "driver@example.com",
      nickname: "Driver One",
      avatarKey: "racer-red",
    });
  });

  test("rejects unauthenticated and unavailable own-profile reads", async () => {
    const unauthenticated = createRoute({ getSubject: async () => null });
    const unavailable = createRoute({ getOwnProfile: async () => null });
    const unauthenticatedResponse = await unauthenticated.route.GET(
      new Request("https://rcmania.live/api/account/profile"),
    );
    const unavailableResponse = await unavailable.route.GET(
      new Request("https://rcmania.live/api/account/profile"),
    );

    expect(unauthenticatedResponse.status).toBe(401);
    expect(unauthenticatedResponse.headers.get("cache-control")).toBe("private, no-store");
    expect((await unauthenticated.route.PATCH(patchRequest({ nickname: "Driver Two", avatarKey: "racer-red" }))).status).toBe(401);
    expect(unavailableResponse.status).toBe(404);
    expect(unavailableResponse.headers.get("cache-control")).toBe("private, no-store");
  });

  test("marks a service-unavailable GET response as private and non-cacheable", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const response = await productionGet(new Request("https://rcmania.live/api/account/profile"));

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  test("uses only the server session subject and rejects client attempts to address another user", async () => {
    const { route, calls } = createRoute();
    const response = await route.PATCH(patchRequest({
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      nickname: "Other Driver",
      avatarKey: "racer-red",
    }));

    expect(response.status).toBe(400);
    expect(calls.subject).toBeUndefined();
  });

  test.each([
    [{ nickname: "Driver Two", avatarKey: "https://attacker.example/avatar.svg" }],
    [{ nickname: "Admin", avatarKey: "racer-red" }],
    [{ nickname: "Driver Two", avatarKey: "racer-red", upload: "data:image/svg+xml,<svg/>" }],
  ])("rejects invalid profile input %#", async (body) => {
    const { route, calls } = createRoute();
    const response = await route.PATCH(patchRequest(body));

    expect(response.status).toBe(400);
    expect(calls.subject).toBeUndefined();
  });

  test("requires same-origin JSON and a bounded request body before updating", async () => {
    const { route, calls } = createRoute();
    const crossOrigin = await route.PATCH(patchRequest(
      { nickname: "Driver Two", avatarKey: "racer-red" },
      { origin: "https://evil.example" },
    ));
    const nonJson = await route.PATCH(new Request("https://rcmania.live/api/account/profile", {
      method: "PATCH",
      headers: { origin: "https://rcmania.live" },
      body: "nickname=Driver+Two",
    }));
    const oversized = await route.PATCH(patchRequest(
      { nickname: "Driver Two", avatarKey: "racer-red" },
      { "content-length": "4097" },
    ));

    expect([crossOrigin.status, nonJson.status, oversized.status]).toEqual([403, 415, 413]);
    expect(calls.subject).toBeUndefined();
  });

  test("does not let forwarded headers redefine the trusted request origin", async () => {
    const { route, calls } = createRoute();
    const response = await route.PATCH(patchRequest(
      { nickname: "Driver Two", avatarKey: "racer-red" },
      {
        origin: "https://evil.example",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example",
      },
    ));

    expect(response.status).toBe(403);
    expect(calls.subject).toBeUndefined();
  });

  test("uses the configured canonical origin behind an internal production proxy", async () => {
    const { route } = createRoute({ canonicalOrigin: "https://rcmania.live" });
    const response = await route.PATCH(new Request("http://web:3000/api/account/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://rcmania.live",
        "x-forwarded-host": "evil.example",
      },
      body: JSON.stringify({ nickname: "Driver Two", avatarKey: "racer-red" }),
    }));

    expect(response.status).toBe(200);
  });

  test("rate-limits nickname changes using only an HMAC digest and updates only the session subject", async () => {
    const { route, calls } = createRoute();
    const response = await route.PATCH(patchRequest({
      nickname: "  Ｄriver Two  ",
      avatarKey: "helmet-lime",
    }));

    expect(response.status).toBe(200);
    expect(calls.subject).toBe(subject);
    expect(calls.profile).toEqual({ nickname: "Driver Two", avatarKey: "helmet-lime" });
    expect(calls.rateLimit).toMatchObject({ kind: "nickname" });
    expect(JSON.stringify(calls.rateLimit)).not.toContain(subject);
    expect(await response.json()).toEqual({
      email: "driver@example.com",
      nickname: "Driver Two",
      avatarKey: "helmet-lime",
    });
  });

  test("returns a generic conflict response without exposing the nickname owner", async () => {
    const { route } = createRoute({ updateOwnProfile: async () => null });
    const response = await route.PATCH(patchRequest({ nickname: "Taken", avatarKey: "racer-red" }));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Profile update unavailable");
    expect(JSON.stringify(body)).not.toMatch(/owner|email|id|taken/i);
  });

  test("does not update when the HMAC-keyed nickname limit is exhausted", async () => {
    const { route, calls } = createRoute({
      takeRateLimitAttempt: async () => ({ allowed: false, remaining: 0, retryAfterMs: 4_100 }),
    });
    const response = await route.PATCH(patchRequest({ nickname: "Driver Two", avatarKey: "racer-red" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(calls.subject).toBeUndefined();
  });
});
