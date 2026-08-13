import { describe, expect, test } from "vitest";

import type { AuthStore } from "./auth-store";
import { loadSessionUser } from "./session-user";

describe("loadSessionUser", () => {
  test("loads an administrator role and balance for the server session", async () => {
    const store: Pick<AuthStore, "getUser" | "getBalance"> = {
      async getUser() {
        return {
          id: "user-1",
          email: "admin@example.com",
          displayName: "Admin Driver",
          role: "admin",
          emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
          disabledAt: null,
        };
      },
      async getBalance() {
        return { currency: "USD", amountMinor: 0 };
      },
    };

    await expect(loadSessionUser(store, "user-1")).resolves.toEqual({
      id: "user-1",
      role: "admin",
      balance: { currency: "USD", amountMinor: 0 },
    });
  });

  test("rejects a session whose user no longer exists", async () => {
    const store: Pick<AuthStore, "getUser" | "getBalance"> = {
      async getUser() {
        return null;
      },
      async getBalance() {
        return { currency: "USD", amountMinor: 0 };
      },
    };

    await expect(loadSessionUser(store, "missing-user")).rejects.toThrow(
      "Session user is unavailable",
    );
  });
});
