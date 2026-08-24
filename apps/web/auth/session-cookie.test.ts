import { describe, expect, test } from "vitest";

import {
  createSessionCookieDefinition,
  createClearedSessionCookie,
  createSessionCookie,
  sessionCookieName,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
} from "./session-cookie";

describe("shared database-session cookie", () => {
  test("uses the secure host-only Auth.js session contract in production", () => {
    expect(createSessionCookieDefinition("production")).toEqual({
      name: "__Secure-authjs.session-token",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 604_800,
      },
    });
  });

  test("uses an HTTP-compatible shared cookie during local development", () => {
    expect(createSessionCookieDefinition("development")).toEqual({
      name: "authjs.session-token",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 604_800,
      },
    });
    expect(sessionCookieName).toBe("authjs.session-token");
    expect(sessionCookieOptions).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 604_800,
    });
  });

  test("creates the same seven-day cookie shape for password sessions", () => {
    const expires = new Date("2026-08-31T12:00:00.000Z");

    expect(createSessionCookie("raw-session-token", expires)).toEqual({
      name: "authjs.session-token",
      value: "raw-session-token",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeSeconds,
        expires,
      },
    });
  });

  test("clears the exact shared development cookie with the same security scope", () => {
    expect(createClearedSessionCookie()).toEqual({
      name: "authjs.session-token",
      value: "",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      },
    });
  });
});
