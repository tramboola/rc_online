import { describe, expect, test } from "vitest";

import { getAccountPresentation } from "./account-presentation";

describe("getAccountPresentation", () => {
  test("shows the generic account entry without a session", () => {
    expect(getAccountPresentation(null)).toEqual({
      state: "signed-out",
      primary: "SIGN IN",
      secondary: "ACCOUNT",
    });
  });

  test("shows the private nickname and bundled avatar without exposing the Google name", () => {
    expect(getAccountPresentation({
      user: {
        id: "user-1",
        role: "admin",
        name: "Test Driver",
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 0 },
        nickname: "Driver-1234ABCD",
        avatarKey: "racer-red",
      },
      expires: "2026-08-10T00:00:00.000Z",
    })).toEqual({
      state: "signed-in",
      primary: "$0.00",
      secondary: "BALANCE",
      displayName: "Driver-1234ABCD",
      email: "driver@example.com",
      avatarKey: "racer-red",
      avatarSrc: "/assets/avatars/racer-red.webp",
      role: "admin",
    });
  });

  test("formats integer minor units as USD", () => {
    const presentation = getAccountPresentation({
      user: {
        id: "user-1",
        role: "user",
        name: "Driver",
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 12345 },
        nickname: "Driver-1234ABCD",
        avatarKey: "racer-red",
      },
      expires: "2026-08-10T00:00:00.000Z",
    });

    expect(presentation.primary).toBe("$123.45");
  });

  test("falls back to the bundled default avatar for an invalid session key", () => {
    const presentation = getAccountPresentation({
      user: {
        id: "user-1",
        role: "user",
        name: null,
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 0 },
        nickname: "Night Racer",
        avatarKey: "https://attacker.example/avatar.svg",
      },
      expires: "2026-08-10T00:00:00.000Z",
    });

    expect(presentation).toMatchObject({
      displayName: "Night Racer",
      avatarKey: "racer-red",
      avatarSrc: "/assets/avatars/racer-red.webp",
    });
  });
});
