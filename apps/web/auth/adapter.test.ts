import type { AdapterUser } from "next-auth/adapters";
import { accountBalances, nicknames, users } from "@rc/database";
import { describe, expect, test, vi } from "vitest";

import { createDefaultNickname, defaultAvatarKey } from "./account-profile";
import { createRcAuthAdapter } from "./adapter";
import type {
  AuthStore,
  StoredAuthSession,
  StoredAuthUser,
} from "./auth-store";
import { createPostgresAuthStore } from "./postgres-auth-store";
import { hashSessionToken } from "./session-token";

const { createDatabaseMock } = vi.hoisted(() => ({
  createDatabaseMock: vi.fn(),
}));

vi.mock("@rc/database", async () => {
  const actual = await vi.importActual<typeof import("@rc/database")>(
    "@rc/database",
  );
  return { ...actual, createDatabase: createDatabaseMock };
});

class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredAuthUser>();
  readonly identities = new Map<string, string>();
  readonly sessions = new Map<string, StoredAuthSession>();
  readonly balances = new Map<string, number>();
  readonly profiles = new Map<string, { nickname: string; avatarKey: string }>();

  async createUser(user: StoredAuthUser): Promise<StoredAuthUser> {
    this.users.set(user.id, user);
    this.balances.set(user.id, 0);
    this.profiles.set(user.id, {
      nickname: createDefaultNickname(user.id),
      avatarKey: defaultAvatarKey,
    });
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

  async getSessionProfile(userId: string): Promise<{ nickname: string; avatarKey: string }> {
    const profile = this.profiles.get(userId);
    if (!profile) {
      throw new Error("Session profile is unavailable");
    }
    return profile;
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
  test("creates a durable user with neutral account state", async () => {
    const store = new MemoryAuthStore();
    const adapter = createRcAuthAdapter(store);

    const created = await adapter.createUser!(googleUser());

    expect(created.email).toBe("driver@example.com");
    await expect(store.getBalance(created.id)).resolves.toEqual({
      currency: "USD",
      amountMinor: 0,
    });
    await expect(store.getSessionProfile(created.id)).resolves.toEqual({
      nickname: "Driver-USER1",
      avatarKey: "racer-red",
    });
  });

  test("creates the user, zero balance, and neutral profile in one database transaction", async () => {
    const insertedRows = new Map<unknown, unknown[]>();
    const transaction = {
      insert(table: unknown) {
        return {
          values(value: unknown) {
            insertedRows.set(table, [
              ...(insertedRows.get(table) ?? []),
              value,
            ]);
            return {
              async returning() {
                return [value];
              },
              onConflictDoNothing() {
                return {
                  async returning() {
                    return [value];
                  },
                };
              },
            };
          },
        };
      },
    };
    createDatabaseMock.mockReturnValueOnce({
      db: {
        async transaction<T>(run: (value: typeof transaction) => Promise<T>) {
          return run(transaction);
        },
      },
    });
    const store = createPostgresAuthStore("postgresql://unused-in-test");

    await store.createUser({
      id: "12ab34cd-5678-90ef-abcd-1234567890ef",
      email: "google.driver@example.com",
      displayName: "Google Driver",
      role: "user",
      emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
      disabledAt: null,
    });

    expect(insertedRows.get(users)).toHaveLength(1);
    expect(insertedRows.get(accountBalances)).toEqual([{
      userId: "12ab34cd-5678-90ef-abcd-1234567890ef",
      currency: "USD",
      amountMinor: 0,
    }]);
    expect(insertedRows.get(nicknames)).toEqual([{
      userId: "12ab34cd-5678-90ef-abcd-1234567890ef",
      nickname: "Driver-12AB34CD",
      avatarKey: "racer-red",
    }]);
  });

  test("lazily creates a missing neutral profile with collision retry", async () => {
    const attemptedProfiles: Array<{
      userId: string;
      nickname: string;
      avatarKey: string;
    }> = [];
    let savedProfile: typeof attemptedProfiles[number] | undefined;
    createDatabaseMock.mockReturnValueOnce({
      db: {
        select() {
          return {
            from() {
              return {
                where() {
                  return {
                    async limit() {
                      return savedProfile ? [savedProfile] : [];
                    },
                  };
                },
              };
            },
          };
        },
        insert(table: unknown) {
          expect(table).toBe(nicknames);
          return {
            values(value: typeof attemptedProfiles[number]) {
              return {
                onConflictDoNothing() {
                  return {
                    async returning() {
                      attemptedProfiles.push(value);
                      if (attemptedProfiles.length === 1) {
                        return [];
                      }
                      savedProfile = value;
                      return [{
                        nickname: value.nickname,
                        avatarKey: value.avatarKey,
                      }];
                    },
                  };
                },
              };
            },
          };
        },
      },
    });
    const store = createPostgresAuthStore("postgresql://unused-in-test");

    await expect(store.getSessionProfile(
      "12ab34cd-5678-90ef-abcd-1234567890ef",
    )).resolves.toEqual({
      nickname: "Driver-12AB34CD-1",
      avatarKey: "racer-red",
    });
    expect(attemptedProfiles.map(({ nickname }) => nickname)).toEqual([
      "Driver-12AB34CD",
      "Driver-12AB34CD-1",
    ]);
  });

  test("retries a colliding profile while creating a user transactionally", async () => {
    const attemptedNicknames: string[] = [];
    const transaction = {
      insert(table: unknown) {
        return {
          values(value: Record<string, unknown>) {
            if (table === nicknames) {
              attemptedNicknames.push(value.nickname as string);
            }
            return {
              async returning() {
                return [value];
              },
              onConflictDoNothing() {
                return {
                  async returning() {
                    if (table === nicknames && attemptedNicknames.length === 1) {
                      return [];
                    }
                    return [value];
                  },
                };
              },
            };
          },
        };
      },
    };
    createDatabaseMock.mockReturnValueOnce({
      db: {
        async transaction<T>(run: (value: typeof transaction) => Promise<T>) {
          return run(transaction);
        },
      },
    });
    const store = createPostgresAuthStore("postgresql://unused-in-test");

    await store.createUser({
      id: "12ab34cd-5678-90ef-abcd-1234567890ef",
      email: "driver@example.com",
      displayName: "Google Driver",
      role: "user",
      emailVerifiedAt: new Date("2026-08-03T00:00:00Z"),
      disabledAt: null,
    });

    expect(attemptedNicknames).toEqual([
      "Driver-12AB34CD",
      "Driver-12AB34CD-1",
    ]);
  });

  test("returns a profile created concurrently for the same user", async () => {
    const concurrentProfile = {
      nickname: "Driver-12AB34CD",
      avatarKey: "racer-red",
    };
    let profileBecameVisible = false;
    let insertAttempts = 0;
    createDatabaseMock.mockReturnValueOnce({
      db: {
        select() {
          return {
            from() {
              return {
                where() {
                  return {
                    async limit() {
                      return profileBecameVisible ? [concurrentProfile] : [];
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            values() {
              return {
                onConflictDoNothing() {
                  return {
                    async returning() {
                      insertAttempts += 1;
                      profileBecameVisible = true;
                      return [];
                    },
                  };
                },
              };
            },
          };
        },
      },
    });
    const store = createPostgresAuthStore("postgresql://unused-in-test");

    await expect(store.getSessionProfile(
      "12ab34cd-5678-90ef-abcd-1234567890ef",
    )).resolves.toEqual(concurrentProfile);
    expect(insertAttempts).toBe(1);
  });

  test("stops lazy profile creation after ten nickname collisions", async () => {
    let attempts = 0;
    createDatabaseMock.mockReturnValueOnce({
      db: {
        select() {
          return {
            from() {
              return {
                where() {
                  return { async limit() { return []; } };
                },
              };
            },
          };
        },
        insert() {
          return {
            values() {
              return {
                onConflictDoNothing() {
                  return {
                    async returning() {
                      attempts += 1;
                      return [];
                    },
                  };
                },
              };
            },
          };
        },
      },
    });
    const store = createPostgresAuthStore("postgresql://unused-in-test");

    await expect(store.getSessionProfile(
      "12ab34cd-5678-90ef-abcd-1234567890ef",
    )).rejects.toThrow("Session profile is unavailable");
    expect(attempts).toBe(10);
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
      role: "user",
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
