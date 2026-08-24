import { describe, expect, test } from "vitest";

import {
  createSessionCookie,
  sessionCookieName,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
} from "./session-cookie";

describe("shared database-session cookie", () => {
  test("uses the secure host-only Auth.js session contract", () => {
    expect(sessionCookieName).toBe("__Secure-authjs.session-token");
    expect(sessionCookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604_800,
    });
  });

  test("creates the same seven-day cookie shape for password sessions", () => {
    const expires = new Date("2026-08-31T12:00:00.000Z");

    expect(createSessionCookie("raw-session-token", expires)).toEqual({
      name: "__Secure-authjs.session-token",
      value: "raw-session-token",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeSeconds,
        expires,
      },
    });
  });
});
