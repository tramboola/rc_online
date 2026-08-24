import { describe, expect, test } from "vitest";

import type { AuthStore } from "./auth-store";
import { loadSessionUser } from "./session-user";

describe("loadSessionUser", () => {
  test("projects the account profile without using Google identity fields", async () => {
    const store: Pick<
      AuthStore,
      "getUser" | "getBalance" | "getSessionProfile"
    > = {
      async getUser() {
        return {
          id: "user-1",
          email: "admin@example.com",
          displayName: "Google Admin Driver",
          role: "admin",
          emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
          disabledAt: null,
        };
      },
      async getBalance() {
        return { currency: "USD", amountMinor: 0 };
      },
      async getSessionProfile() {
        return { nickname: "Driver-1234ABCD", avatarKey: "racer-red" };
      },
    };

    await expect(loadSessionUser(store, "user-1")).resolves.toEqual({
      id: "user-1",
      role: "admin",
      balance: { currency: "USD", amountMinor: 0 },
      nickname: "Driver-1234ABCD",
      avatarKey: "racer-red",
    });
  });

  test("rejects a session whose user no longer exists", async () => {
    const store: Pick<
      AuthStore,
      "getUser" | "getBalance" | "getSessionProfile"
    > = {
      async getUser() {
        return null;
      },
      async getBalance() {
        return { currency: "USD", amountMinor: 0 };
      },
      async getSessionProfile() {
        throw new Error("profile must not be created for a missing user");
      },
    };

    await expect(loadSessionUser(store, "missing-user")).rejects.toThrow(
      "Session user is unavailable",
    );
  });

  test("rejects a disabled user before loading account state", async () => {
    const store: Pick<
      AuthStore,
      "getUser" | "getBalance" | "getSessionProfile"
    > = {
      async getUser() {
        return {
          id: "disabled-user",
          email: "disabled@example.com",
          displayName: "Disabled Google Driver",
          role: "user",
          emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
          disabledAt: new Date("2026-08-04T00:00:00Z"),
        };
      },
      async getBalance() {
        throw new Error("balance must not be loaded for a disabled user");
      },
      async getSessionProfile() {
        throw new Error("profile must not be created for a disabled user");
      },
    };

    await expect(loadSessionUser(store, "disabled-user")).rejects.toThrow(
      "Session user is unavailable",
    );
  });
});
