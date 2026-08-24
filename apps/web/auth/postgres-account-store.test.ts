import {
  accountActionTokens,
  accountBalances,
  authRateLimits,
  authSessions,
  consents,
  nicknames,
  oauthIdentities,
  passwordCredentials,
  users,
} from "@rc/database";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  AccountRegistrationUnavailableError,
  createPostgresAccountStore,
} from "./postgres-account-store";

const { createDatabaseMock } = vi.hoisted(() => ({
  createDatabaseMock: vi.fn(),
}));

vi.mock("@rc/database", async () => {
  const actual = await vi.importActual<typeof import("@rc/database")>("@rc/database");
  return { ...actual, createDatabase: createDatabaseMock };
});

type Operation = {
  kind: "select" | "insert" | "update" | "delete";
  table: unknown;
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  condition?: unknown;
  limit?: number;
  conflict?: "nothing" | "update";
  inTransaction: boolean;
};

type Script = {
  kind: Operation["kind"];
  table: unknown;
  rows: unknown[];
};

type ScriptedExecutor = {
  select: () => unknown;
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
  transaction: <T>(run: (transaction: ScriptedExecutor) => Promise<T>) => Promise<T>;
};

function createScriptedDatabase(scripts: Script[]) {
  const operations: Operation[] = [];
  let transactionDepth = 0;

  const complete = (operation: Operation) => {
    operations.push(operation);
    const next = scripts.shift();
    expect(next?.kind).toBe(operation.kind);
    expect(next?.table).toBe(operation.table);
    return Promise.resolve(next?.rows ?? []);
  };

  const executor: ScriptedExecutor = {
    select() {
      const operation: Operation = {
        kind: "select",
        table: undefined,
        inTransaction: transactionDepth > 0,
      };
      const builder = {
        from(table: unknown) {
          operation.table = table;
          return builder;
        },
        innerJoin() { return builder; },
        leftJoin() { return builder; },
        where(condition: unknown) {
          operation.condition = condition;
          return builder;
        },
        limit(limit: number) {
          operation.limit = limit;
          return complete(operation);
        },
      };
      return builder;
    },
    insert(table: unknown) {
      const operation: Operation = {
        kind: "insert",
        table,
        inTransaction: transactionDepth > 0,
      };
      return {
        values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          operation.values = values;
          const builder = {
            returning() { return complete(operation); },
            onConflictDoNothing() {
              operation.conflict = "nothing";
              return builder;
            },
            onConflictDoUpdate() {
              operation.conflict = "update";
              return builder;
            },
          };
          return builder;
        },
      };
    },
    update(table: unknown) {
      const operation: Operation = {
        kind: "update",
        table,
        inTransaction: transactionDepth > 0,
      };
      return {
        set(values: Record<string, unknown>) {
          operation.values = values;
          return {
            where(condition: unknown) {
              operation.condition = condition;
              return { returning: () => complete(operation) };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      const operation: Operation = {
        kind: "delete",
        table,
        inTransaction: transactionDepth > 0,
      };
      return {
        where(condition: unknown) {
          operation.condition = condition;
          return { returning: () => complete(operation) };
        },
      };
    },
    async transaction<T>(run: (transaction: typeof executor) => Promise<T>) {
      transactionDepth += 1;
      try {
        return await run(executor);
      } finally {
        transactionDepth -= 1;
      }
    },
  };

  return { db: executor, operations, scripts };
}

function sqlText(condition: unknown): string {
  const query = new PgDialect().sqlToQuery(condition as never);
  return `${query.sql} ${query.params.join(" ")}`;
}

const now = new Date("2026-08-24T12:00:00.000Z");
const userId = "11111111-2222-4333-8444-555555555555";
const uuidSequence = [
  userId,
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "12345678-90ab-4cde-8f01-234567890abc",
];

function installDatabase(scripts: Script[], randomValues = uuidSequence) {
  const scripted = createScriptedDatabase(scripts);
  createDatabaseMock.mockReturnValueOnce({ db: scripted.db });
  let index = 0;
  const store = createPostgresAccountStore("postgresql://unused-in-test", {
    now: () => now,
    randomUuid: () => randomValues[index++] ?? randomValues.at(-1)!,
  });
  return { store, ...scripted };
}

describe("createPostgresAccountStore", () => {
  beforeEach(() => {
    createDatabaseMock.mockReset();
  });

  test("registers a normalized password-only account atomically with neutral state and legal notices", async () => {
    const { store, operations, scripts } = installDatabase([
      { kind: "select", table: users, rows: [] },
      { kind: "insert", table: users, rows: [{ id: userId, email: "driver@example.com" }] },
      { kind: "insert", table: passwordCredentials, rows: [{ userId }] },
      { kind: "insert", table: accountBalances, rows: [{ userId }] },
      { kind: "insert", table: nicknames, rows: [] },
      { kind: "insert", table: nicknames, rows: [{ nickname: "Driver-12345678" }] },
      { kind: "insert", table: consents, rows: [{ id: "terms" }] },
      { kind: "insert", table: consents, rows: [{ id: "privacy" }] },
      { kind: "insert", table: accountActionTokens, rows: [{ id: "token" }] },
    ]);

    await expect(store.registerPendingAccount({
      email: "  Driver@Example.COM ",
      passwordHash: "argon-hash",
      verificationTokenHash: "a".repeat(64),
      verificationExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      legalRevision: "2026-08-24",
    })).resolves.toEqual({ userId, email: "driver@example.com" });

    expect(scripts).toHaveLength(0);
    expect(operations.every((operation) => operation.inTransaction)).toBe(true);
    expect(operations.find((operation) => operation.table === users && operation.kind === "insert")?.values)
      .toMatchObject({ email: "driver@example.com", displayName: "RC Mania driver" });
    expect(operations.find((operation) => operation.table === passwordCredentials)?.values)
      .toMatchObject({ userId, passwordHash: "argon-hash", verifiedAt: null });
    expect(operations.find((operation) => operation.table === accountBalances)?.values)
      .toEqual({ userId, currency: "USD", amountMinor: 0 });
    expect(operations.filter((operation) => operation.table === nicknames).map((operation) => operation.values))
      .toEqual([
        { userId, nickname: "Driver-AAAAAAAA", avatarKey: "racer-red" },
        { userId, nickname: "Driver-12345678", avatarKey: "racer-red" },
      ]);
    expect(operations.filter((operation) => operation.table === consents).map((operation) => operation.values))
      .toEqual([
        expect.objectContaining({ userId, kind: "terms_of_service", documentVersion: "2026-08-24", accepted: true }),
        expect.objectContaining({ userId, kind: "privacy_policy_notice", documentVersion: "2026-08-24", accepted: true }),
      ]);
  });

  test("attaches an unverified password factor to an eligible Google account", async () => {
    const { store, operations } = installDatabase([
      { kind: "select", table: users, rows: [{ id: userId, email: "driver@example.com", disabledAt: null }] },
      { kind: "select", table: passwordCredentials, rows: [] },
      { kind: "select", table: oauthIdentities, rows: [{ id: "google" }] },
      { kind: "insert", table: passwordCredentials, rows: [{ userId }] },
      { kind: "insert", table: consents, rows: [{ id: "terms" }] },
      { kind: "insert", table: consents, rows: [{ id: "privacy" }] },
      { kind: "insert", table: accountActionTokens, rows: [{ id: "token" }] },
    ]);

    await store.registerPendingAccount({
      email: "DRIVER@example.com",
      passwordHash: "argon-hash",
      verificationTokenHash: "b".repeat(64),
      verificationExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      legalRevision: "2026-08-24",
    });

    expect(operations.find((operation) => operation.table === passwordCredentials && operation.kind === "insert")?.values)
      .toMatchObject({ userId, verifiedAt: null });
    expect(operations.some((operation) => operation.table === users && operation.kind === "insert")).toBe(false);
    expect(operations.some((operation) => operation.table === accountBalances)).toBe(false);
    expect(operations.some((operation) => operation.table === nicknames)).toBe(false);
  });

  test("rejects existing password credentials through one generic error", async () => {
    const { store } = installDatabase([
      { kind: "select", table: users, rows: [{ id: userId, email: "driver@example.com", disabledAt: null }] },
      { kind: "select", table: passwordCredentials, rows: [{ userId }] },
    ]);

    await expect(store.registerPendingAccount({
      email: "driver@example.com",
      passwordHash: "argon-hash",
      verificationTokenHash: "c".repeat(64),
      verificationExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      legalRevision: "2026-08-24",
    })).rejects.toBeInstanceOf(AccountRegistrationUnavailableError);
  });

  test("consumes a live verification token once and verifies both email and password factor", async () => {
    const { store, operations } = installDatabase([
      { kind: "update", table: accountActionTokens, rows: [{ userId }] },
      { kind: "update", table: users, rows: [{ id: userId, email: "driver@example.com" }] },
      { kind: "update", table: passwordCredentials, rows: [{ userId }] },
    ]);

    await expect(store.consumeActionToken({
      kind: "verify_email",
      tokenHash: "d".repeat(64),
      now,
    })).resolves.toEqual({ userId, email: "driver@example.com" });

    const tokenUpdate = operations[0]!;
    expect(sqlText(tokenUpdate.condition)).toMatch(/consumed_at.*is null/i);
    expect(sqlText(tokenUpdate.condition)).toMatch(/expires_at.*>/i);
    expect(operations.filter((operation) => operation.kind === "update").map((operation) => operation.table))
      .toEqual([accountActionTokens, users, passwordCredentials]);
  });

  test("returns null without side effects for an expired, consumed, or wrong-purpose token", async () => {
    const { store, operations } = installDatabase([
      { kind: "update", table: accountActionTokens, rows: [] },
    ]);

    await expect(store.consumeActionToken({
      kind: "verify_email",
      tokenHash: "e".repeat(64),
      now,
    })).resolves.toBeNull();
    expect(operations).toHaveLength(1);
  });

  test("finds only an active candidate with a separately verified password factor", async () => {
    const { store, operations } = installDatabase([
      {
        kind: "select",
        table: users,
        rows: [{
          userId,
          email: "driver@example.com",
          passwordHash: "argon-hash",
        }],
      },
    ]);

    await expect(store.findPasswordSignIn(" DRIVER@EXAMPLE.COM ")).resolves.toEqual({
      userId,
      email: "driver@example.com",
      passwordHash: "argon-hash",
    });
    const condition = sqlText(operations[0]!.condition);
    expect(condition).toContain("driver@example.com");
    expect(condition).toMatch(/disabled_at.*is null/i);
    expect(condition).toMatch(/verified_at.*is not null/i);
  });

  test("replaces a password only through a live reset token and revokes all sessions and reset tokens", async () => {
    const { store, operations } = installDatabase([
      { kind: "update", table: accountActionTokens, rows: [{ userId }] },
      { kind: "update", table: passwordCredentials, rows: [{ userId }] },
      { kind: "delete", table: authSessions, rows: [{ id: "session" }] },
      { kind: "delete", table: accountActionTokens, rows: [{ id: "reset" }] },
      { kind: "select", table: users, rows: [{ email: "driver@example.com" }] },
    ]);

    await expect(store.replacePasswordAndRevokeSessions({
      resetTokenHash: "f".repeat(64),
      newPasswordHash: "new-argon-hash",
      now,
    })).resolves.toEqual({ userId, email: "driver@example.com" });

    expect(operations.every((operation) => operation.inTransaction)).toBe(true);
    expect(operations.find((operation) => operation.table === passwordCredentials)?.values)
      .toMatchObject({ passwordHash: "new-argon-hash", passwordChangedAt: now });
    expect(sqlText(operations[0]!.condition)).toMatch(/disabled_at.*is null/i);
    expect(operations.filter((operation) => operation.kind === "delete").map((operation) => operation.table))
      .toEqual([authSessions, accountActionTokens]);
  });

  test("returns an exact private own-profile DTO selected by the authenticated subject", async () => {
    const { store, operations } = installDatabase([
      {
        kind: "select",
        table: users,
        rows: [{ email: "driver@example.com", nickname: "Night Rider", avatarKey: "racer-red", role: "admin" }],
      },
    ]);

    const profile = await store.getOwnProfile(userId);

    expect(profile).toEqual({ email: "driver@example.com", nickname: "Night Rider", avatarKey: "racer-red" });
    expect(Object.keys(profile!).sort()).toEqual(["avatarKey", "email", "nickname"]);
    expect(profile).not.toHaveProperty("role");
    expect(profile).not.toHaveProperty("balance");
    expect(profile).not.toHaveProperty("passwordHash");
    expect(sqlText(operations[0]!.condition)).toContain(userId);
  });

  test("normalizes a nickname and updates only the authenticated subject profile", async () => {
    const { store, operations } = installDatabase([
      { kind: "update", table: nicknames, rows: [{ userId }] },
      { kind: "select", table: users, rows: [{ email: "driver@example.com", nickname: "Å Racer", avatarKey: "racer-cyan" }] },
    ]);

    await expect(store.updateOwnProfile(userId, {
      nickname: "  A\u030A Racer  ",
      avatarKey: "racer-cyan",
    })).resolves.toEqual({ email: "driver@example.com", nickname: "Å Racer", avatarKey: "racer-cyan" });

    expect(operations[0]!.values).toMatchObject({ nickname: "Å Racer", avatarKey: "racer-cyan" });
    expect(sqlText(operations[0]!.condition)).toContain(userId);
    expect(sqlText(operations[0]!.condition)).toMatch(/disabled_at.*is null/i);
  });

  test("deletes private account material and irreversibly anonymizes the user in one transaction", async () => {
    const deletedUuid = "deadbeef-dead-4bee-8bad-deadbeef0001";
    const { store, operations } = installDatabase([
      { kind: "delete", table: authSessions, rows: [] },
      { kind: "delete", table: passwordCredentials, rows: [] },
      { kind: "delete", table: accountActionTokens, rows: [] },
      { kind: "delete", table: oauthIdentities, rows: [] },
      { kind: "delete", table: nicknames, rows: [] },
      { kind: "delete", table: consents, rows: [] },
      { kind: "update", table: users, rows: [{ id: userId }] },
    ], [deletedUuid]);

    await expect(store.deleteOwnAccount(userId)).resolves.toBe(true);

    expect(operations.every((operation) => operation.inTransaction)).toBe(true);
    expect(operations.filter((operation) => operation.kind === "delete").map((operation) => operation.table))
      .toEqual([authSessions, passwordCredentials, accountActionTokens, oauthIdentities, nicknames, consents]);
    expect(operations.at(-1)?.values).toMatchObject({
      email: `deleted+${deletedUuid}@invalid.rcmania`,
      displayName: "Deleted driver",
      disabledAt: now,
    });
    expect(operations.some((operation) => operation.table === accountBalances && operation.kind === "delete")).toBe(false);
  });

  test("accepts only bounded HMAC digests and increments one fixed rate window", async () => {
    const keyHash = "1".repeat(64);
    const { store, operations } = installDatabase([
      { kind: "insert", table: authRateLimits, rows: [{ attemptCount: 3 }] },
    ]);

    await expect(store.takeRateLimitAttempt({
      keyHash,
      kind: "sign_in",
      now,
      windowMs: 60_000,
      limit: 3,
    })).resolves.toEqual({ allowed: true, remaining: 0, retryAfterMs: 60_000 });
    expect(operations[0]!.conflict).toBe("update");
    expect(operations[0]!.values).toMatchObject({
      keyHash,
      kind: "sign_in",
      windowStartedAt: now,
      expiresAt: new Date("2026-08-24T12:01:00.000Z"),
    });

    await expect(store.takeRateLimitAttempt({
      keyHash: "driver@example.com",
      kind: "sign_in",
      now,
      windowMs: 60_000,
      limit: 3,
    })).rejects.toThrow("Rate-limit key must be an HMAC digest");
  });

  test("bounds every cleanup scan and never selects Google-linked or verified accounts", async () => {
    const { store, operations } = installDatabase([
      { kind: "select", table: accountActionTokens, rows: [] },
      { kind: "select", table: authRateLimits, rows: [] },
      { kind: "select", table: users, rows: [] },
    ]);

    await expect(store.cleanupExpiredAccountData({ now, batchSize: 25 })).resolves.toEqual({
      tokensDeleted: 0,
      rateLimitRowsDeleted: 0,
      accountsDeleted: 0,
    });

    expect(operations.map((operation) => operation.limit)).toEqual([25, 25, 25]);
    const accountCondition = sqlText(operations[2]!.condition);
    expect(accountCondition).toMatch(/verified_at.*is null/i);
    expect(accountCondition).toMatch(/oauth_identities/i);
  });

  test("rejects a non-finite cleanup batch before issuing a database query", async () => {
    const { store, operations } = installDatabase([]);

    await expect(store.cleanupExpiredAccountData({
      now,
      batchSize: Number.NaN,
    })).rejects.toThrow("Cleanup batch size must be finite");
    expect(operations).toHaveLength(0);
  });
});
