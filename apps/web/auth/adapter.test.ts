import type { AdapterUser } from "next-auth/adapters";
import { describe, expect, test } from "vitest";

import { createRcAuthAdapter } from "./adapter";
import type {
  AuthStore,
  StoredAuthSession,
  StoredAuthUser,
} from "./auth-store";
import { hashSessionToken } from "./session-token";

class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredAuthUser>();
  readonly identities = new Map<string, string>();
  readonly sessions = new Map<string, StoredAuthSession>();
  readonly balances = new Map<string, number>();

  async createUser(user: StoredAuthUser): Promise<StoredAuthUser> {
    this.users.set(user.id, user);
    this.balances.set(user.id, 0);
    return user;
  }

  async getUser(id: string): Promise<StoredAuthUser | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByEmail(email: string): Promise<StoredAuthUser | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async getUserByIdentity(provider: string, subject: string): Promise<StoredAuthUser | null> {
    const userId = this.identities.get(`${provider}:${subject}`);
    return userId ? this.getUser(userId) : null;
  }

  async updateUser(user: StoredAuthUser): Promise<StoredAuthUser> {
    this.users.set(user.id, user);
    return user;
  }

  async linkIdentity(userId: string, provider: string, subject: string): Promise<void> {
    this.identities.set(`${provider}:${subject}`, userId);
  }

  async createSession(session: StoredAuthSession): Promise<StoredAuthSession> {
    this.sessions.set(session.tokenHash, session);
    return session;
  }

  async getSession(tokenHash: string): Promise<StoredAuthSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async updateSession(session: StoredAuthSession): Promise<StoredAuthSession> {
    this.sessions.set(session.tokenHash, session);
    return session;
  }

  async deleteSession(tokenHash: string): Promise<StoredAuthSession | null> {
    const session = this.sessions.get(tokenHash) ?? null;
    this.sessions.delete(tokenHash);
    return session;
  }

  async getBalance(userId: string): Promise<{ currency: "USD"; amountMinor: number }> {
    return { currency: "USD", amountMinor: this.balances.get(userId) ?? 0 };
  }
}

function googleUser(id = "user-1"): AdapterUser {
  return {
    id,
    email: "driver@example.com",
    emailVerified: new Date("2026-08-03T00:00:00Z"),
    name: "Test Driver",
    image: null,
  };
}

describe("createRcAuthAdapter", () => {
  test("creates a durable user with a zero USD balance", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store);

    const created = await adapter.createUser!(googleUser());

    expect(created.email).toBe("driver@example.com");
    await expect(store.getBalance(created.id)).resolves.toEqual({
      currency: "USD",
      amountMinor: 0,
    });
  });

  test("resolves repeat login by the immutable Google subject", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store);
    const created = await adapter.createUser!(googleUser());

    await adapter.linkAccount!({
      type: "oidc",
      provider: "google",
      providerAccountId: "google-subject-1",
      userId: created.id,
    });

    await expect(adapter.getUserByAccount!({
      provider: "google",
      providerAccountId: "google-subject-1",
    })).resolves.toEqual(created);
  });

  test("treats disabled users as signed out", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store);
    await store.createUser({
      ...googleUser(),
      displayName: "Test Driver",
      emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
      disabledAt: new Date("2026-08-03T01:00:00Z"),
    });

    await expect(adapter.getUser!("user-1")).resolves.toBeNull();
  });

  test("hashes session tokens and deletes expired sessions", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store, () => new Date("2026-08-03T12:00:00Z"));
    await adapter.createUser!(googleUser());

    await adapter.createSession!({
      sessionToken: "raw-browser-secret",
      userId: "user-1",
      expires: new Date("2026-08-03T11:00:00Z"),
    });

    expect(store.sessions.has("raw-browser-secret")).toBe(false);
    expect(store.sessions.has(hashSessionToken("raw-browser-secret"))).toBe(true);
    await expect(adapter.getSessionAndUser!("raw-browser-secret")).resolves.toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  test("deleting a session invalidates future lookup", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store);
    await adapter.createUser!(googleUser());
    await adapter.createSession!({
      sessionToken: "raw-browser-secret",
      userId: "user-1",
      expires: new Date("2099-01-01T00:00:00Z"),
    });

    await adapter.deleteSession!("raw-browser-secret");

    await expect(adapter.getSessionAndUser!("raw-browser-secret")).resolves.toBeNull();
  });
});
