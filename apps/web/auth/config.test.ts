import { describe, expect, test } from "vitest";

import {
  readAuthRuntimeEnvironment,
  sanitizeReturnPath,
} from "./config";

describe("sanitizeReturnPath", () => {
  test.each(["/", "/pricing", "/leaderboard?season=2026"])(
    "accepts same-origin path %s",
    (path) => expect(sanitizeReturnPath(path)).toBe(path),
  );

  test.each([
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil", "/"],
    ["/pricing\nSet-Cookie: bad", "/"],
  ])("rejects unsafe return value %s", (value, expected) => {
    expect(sanitizeReturnPath(value)).toBe(expected);
  });
});

describe("readAuthRuntimeEnvironment", () => {
  test("returns the required server-only values", () => {
    expect(readAuthRuntimeEnvironment({
      AUTH_SECRET: "a".repeat(32),
      AUTH_URL: "https://rcmania.live",
      DATABASE_URL: "postgresql://rc:secret@postgres:5432/rcmania",
      GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    })).toEqual({
      authSecret: "a".repeat(32),
      authUrl: "https://rcmania.live",
      databaseUrl: "postgresql://rc:secret@postgres:5432/rcmania",
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "google-secret",
    });
  });

  test("reports only a missing key name, never another secret value", () => {
    expect(() => readAuthRuntimeEnvironment({
      AUTH_SECRET: "a".repeat(32),
      AUTH_URL: "https://rcmania.live",
      DATABASE_URL: "postgresql://rc:do-not-log@postgres:5432/rcmania",
      GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
    })).toThrow("Missing required auth environment variable: GOOGLE_OAUTH_CLIENT_SECRET");
  });
});
