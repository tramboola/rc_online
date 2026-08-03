import { describe, expect, test } from "vitest";

import { getAccountPresentation } from "./account-presentation";

describe("getAccountPresentation", () => {
  test("shows an honest Google sign-in control without a session", () => {
    expect(getAccountPresentation(null)).toEqual({
      state: "signed-out",
      primary: "SIGN IN",
      secondary: "WITH GOOGLE",
    });
  });

  test("shows a real zero USD balance and account identity", () => {
    expect(getAccountPresentation({
      user: {
        id: "user-1",
        name: "Test Driver",
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 0 },
      },
      expires: "2026-08-10T00:00:00.000Z",
    })).toEqual({
      state: "signed-in",
      primary: "$0.00",
      secondary: "BALANCE",
      displayName: "Test Driver",
      email: "driver@example.com",
      initials: "TD",
    });
  });

  test("formats integer minor units as USD", () => {
    const presentation = getAccountPresentation({
      user: {
        id: "user-1",
        name: "Driver",
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 12345 },
      },
      expires: "2026-08-10T00:00:00.000Z",
    });

    expect(presentation.primary).toBe("$123.45");
  });

  test("uses email when a profile name is unavailable", () => {
    const presentation = getAccountPresentation({
      user: {
        id: "user-1",
        name: null,
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 0 },
      },
      expires: "2026-08-10T00:00:00.000Z",
    });

    expect(presentation).toMatchObject({
      displayName: "driver@example.com",
      initials: "D",
    });
  });

  test("keeps initials bounded for long names", () => {
    const presentation = getAccountPresentation({
      user: {
        id: "user-1",
        name: "Alexandra Very Long Racing Driver Name",
        email: "driver@example.com",
        image: null,
        balance: { currency: "USD", amountMinor: 0 },
      },
      expires: "2026-08-10T00:00:00.000Z",
    });

    expect(presentation.state).toBe("signed-in");
    if (presentation.state === "signed-in") {
      expect(presentation.initials).toBe("AN");
    }
  });
});
