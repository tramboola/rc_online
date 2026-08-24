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
      RESEND_API_KEY: "resend-secret",
      AUTH_EMAIL_FROM: "RC Mania <accounts@updates.rcmania.live>",
      AUTH_SUPPORT_EMAIL: "support@rcmania.live",
      AUTH_RATE_LIMIT_SECRET: "rate-limit-secret",
    })).toEqual({
      authSecret: "a".repeat(32),
      authUrl: "https://rcmania.live",
      databaseUrl: "postgresql://rc:secret@postgres:5432/rcmania",
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "google-secret",
      resendApiKey: "resend-secret",
      authEmailFrom: "RC Mania <accounts@updates.rcmania.live>",
      authSupportEmail: "support@rcmania.live",
      authRateLimitSecret: "rate-limit-secret",
    });
  });

  test("reports only a missing key name, never another secret value", () => {
    expect(() => readAuthRuntimeEnvironment({
      AUTH_SECRET: "a".repeat(32),
      AUTH_URL: "https://rcmania.live",
      DATABASE_URL: "postgresql://rc:do-not-log@postgres:5432/rcmania",
      GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
      RESEND_API_KEY: "resend-secret",
      AUTH_EMAIL_FROM: "RC Mania <accounts@updates.rcmania.live>",
      AUTH_SUPPORT_EMAIL: "support@rcmania.live",
      AUTH_RATE_LIMIT_SECRET: "rate-limit-secret",
    })).toThrow("Missing required auth environment variable: GOOGLE_OAUTH_CLIENT_SECRET");
  });

  test.each([
    "RESEND_API_KEY",
    "AUTH_EMAIL_FROM",
    "AUTH_SUPPORT_EMAIL",
    "AUTH_RATE_LIMIT_SECRET",
  ])("requires server-only value %s", (missingKey) => {
    const env: Record<string, string | undefined> = {
      AUTH_SECRET: "a".repeat(32),
      AUTH_URL: "https://rcmania.live",
      DATABASE_URL: "postgresql://rc:secret@postgres:5432/rcmania",
      GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      RESEND_API_KEY: "resend-secret",
      AUTH_EMAIL_FROM: "RC Mania <accounts@updates.rcmania.live>",
      AUTH_SUPPORT_EMAIL: "support@rcmania.live",
      AUTH_RATE_LIMIT_SECRET: "rate-limit-secret",
    };
    delete env[missingKey];

    expect(() => readAuthRuntimeEnvironment(env)).toThrow(
      `Missing required auth environment variable: ${missingKey}`,
    );
  });

  test.each([
    "http://rcmania.live",
    "http://localhost:3000",
    "https://rcmania.live/",
    "https://rcmania.live/path",
    "https://rcmania.live?source=bad",
  ])("rejects non-canonical AUTH_URL %s", (authUrl) => {
    expect(() => readAuthRuntimeEnvironment({
      AUTH_SECRET: "a".repeat(32),
      AUTH_URL: authUrl,
      DATABASE_URL: "postgresql://rc:secret@postgres:5432/rcmania",
      GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      RESEND_API_KEY: "resend-secret",
      AUTH_EMAIL_FROM: "RC Mania <accounts@updates.rcmania.live>",
      AUTH_SUPPORT_EMAIL: "support@rcmania.live",
      AUTH_RATE_LIMIT_SECRET: "rate-limit-secret",
    })).toThrow("AUTH_URL must be a canonical HTTPS origin");
  });
});
