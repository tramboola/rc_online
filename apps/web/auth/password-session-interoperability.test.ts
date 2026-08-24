import { describe, expect, test, vi } from "vitest";

import { createRcAuthAdapter } from "./adapter";
import type { AccountStore } from "./account-store";
import { createAccountService } from "./account-service";
import type { AuthStore, StoredAuthSession, StoredAuthUser } from "./auth-store";
import { loadSessionUser } from "./session-user";
import { hashSessionToken } from "./session-token";

class MemoryAuthStore implements AuthStore {
  readonly sessions = new Map<string, StoredAuthSession>();

  constructor(private readonly user: StoredAuthUser) {}

  async createUser(user: StoredAuthUser) { return user; }
  async getUser(id: string) { return id === this.user.id ? this.user : null; }
  async getUserByEmail(email: string) { return email === this.user.email ? this.user : null; }
  async getUserByIdentity() { return null; }
  async updateUser(user: StoredAuthUser) { return user; }
  async linkIdentity() {}
  async createSession(session: StoredAuthSession) {
    this.sessions.set(session.tokenHash, session);
    return session;
  }
  async getSession(tokenHash: string) { return this.sessions.get(tokenHash) ?? null; }
  async updateSession(session: StoredAuthSession) {
    this.sessions.set(session.tokenHash, session);
    return session;
  }
  async deleteSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash) ?? null;
    this.sessions.delete(tokenHash);
    return session;
  }
  async getBalance() { return { currency: "USD" as const, amountMinor: 1250 }; }
  async getSessionProfile() { return { nickname: "NightRacer", avatarKey: "racer-cyan" }; }
}

describe("password session interoperability", () => {
  test("creates a session that the existing Auth.js adapter and session projection can read", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const user: StoredAuthUser = {
      id: "11111111-2222-4333-8444-555555555555",
      email: "driver@example.com",
      displayName: "Private account name",
      role: "admin",
      emailVerifiedAt: now,
      disabledAt: null,
    };
    const authStore = new MemoryAuthStore(user);
    const accountStore = {
      findPasswordSignIn: vi.fn(async () => ({
        userId: user.id,
        email: user.email,
        passwordHash: "stored-argon-hash",
      })),
      takeRateLimitAttempt: vi.fn(async () => ({
        allowed: true,
        remaining: 9,
        retryAfterMs: 0,
      })),
    } as unknown as AccountStore;
    const rawToken = "password-session-secret";
    const service = createAccountService({
      accountStore,
      authStore,
      email: {
        async sendVerification() {},
        async sendPasswordReset() {},
        async sendPasswordChanged() {},
        async sendAccountDeleted() {},
      },
      now: () => now,
      createAccountToken: () => ({ raw: "unused", hash: "a".repeat(64) }),
      hashAccountToken: (raw) => `unused:${raw}`,
      hashPassword: async (password) => `unused:${password}`,
      verifyPassword: async () => ({ valid: true, needsRehash: false }),
      dummyPasswordHash: "dummy-argon-hash",
      createSessionToken: () => rawToken,
      hashSessionToken,
    });

    await expect(service.signInPassword({
      email: user.email,
      password: "correct horse battery",
      ipKeyHash: "1".repeat(64),
      accountKeyHash: "2".repeat(64),
    })).resolves.toMatchObject({ kind: "authenticated", token: rawToken });

    expect(authStore.sessions.has(rawToken)).toBe(false);
    expect(authStore.sessions.has(hashSessionToken(rawToken))).toBe(true);

    const authenticated = await createRcAuthAdapter(
      authStore,
      () => new Date("2026-08-24T12:01:00.000Z"),
    ).getSessionAndUser!(rawToken);

    expect(authenticated?.user.id).toBe(user.id);
    await expect(loadSessionUser(authStore, authenticated!.user.id)).resolves.toEqual({
      id: user.id,
      role: "admin",
      balance: { currency: "USD", amountMinor: 1250 },
      nickname: "NightRacer",
      avatarKey: "racer-cyan",
    });
  });
});
