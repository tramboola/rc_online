import { describe, expect, test, vi } from "vitest";

import type { AccountStore } from "./account-store";
import type { AuthStore } from "./auth-store";
import { createAccountService } from "./account-service";
import { AccountRegistrationUnavailableError } from "./postgres-account-store";
import type { TransactionalEmail } from "./transactional-email";

const now = new Date("2026-08-24T12:00:00.000Z");
const userId = "11111111-2222-4333-8444-555555555555";
const ipKeyHash = "1".repeat(64);
const accountKeyHash = "2".repeat(64);

function dependencies(overrides: Record<string, unknown> = {}) {
  const accountStore = {
    registerPendingAccount: vi.fn(async () => ({ userId, email: "driver@example.com" })),
    createOrRotateActionToken: vi.fn(async (): Promise<{ userId: string; email: string } | null> => ({ userId, email: "driver@example.com" })),
    consumeActionToken: vi.fn(async (): Promise<{ userId: string; email: string } | null> => ({ userId, email: "driver@example.com" })),
    findPasswordSignIn: vi.fn(async (): Promise<{ userId: string; email: string; passwordHash: string } | null> => ({ userId, email: "driver@example.com", passwordHash: "stored-hash" })),
    replacePasswordAndRevokeSessions: vi.fn(),
    getOwnProfile: vi.fn(),
    updateOwnProfile: vi.fn(),
    deleteOwnAccount: vi.fn(),
    takeRateLimitAttempt: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterMs: 1_000 })),
    cleanupExpiredAccountData: vi.fn(),
  } satisfies AccountStore;
  const authStore = {
    createSession: vi.fn(async (session) => session),
  } as Pick<AuthStore, "createSession">;
  const email = {
    sendVerification: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async () => undefined),
    sendPasswordChanged: vi.fn(async () => undefined),
    sendAccountDeleted: vi.fn(async () => undefined),
  } satisfies TransactionalEmail;
  const tokenValues = [
    { raw: "raw-verification-token", hash: "a".repeat(64) },
    { raw: "raw-rotated-token", hash: "b".repeat(64) },
  ];
  const base = {
    accountStore,
    authStore,
    email,
    now: () => now,
    createAccountToken: vi.fn(() => tokenValues.shift() ?? { raw: "raw-fallback", hash: "c".repeat(64) }),
    hashAccountToken: vi.fn((raw: string) => `hashed:${raw}`),
    hashPassword: vi.fn(async (password: string) => `argon:${password}`),
    verifyPassword: vi.fn(async () => ({ valid: true, needsRehash: false })),
    dummyPasswordHash: "dummy-argon-hash",
    createSessionToken: vi.fn(() => "raw-browser-session-token"),
    hashSessionToken: vi.fn(() => "d".repeat(64)),
    ...overrides,
  };
  return { service: createAccountService(base), accountStore, authStore, email, base };
}

describe("account service", () => {
  test("registers a normalized pending account with a hashed password and hashed 24-hour token", async () => {
    const { service, accountStore, email, base } = dependencies();

    await expect(service.register({
      email: "  Driver@Example.COM ",
      password: "correct horse battery",
      ipKeyHash,
      accountKeyHash,
      legalRevision: "2026-08-24",
    })).resolves.toEqual({ kind: "accepted" });

    expect(accountStore.registerPendingAccount).toHaveBeenCalledWith({
      email: "driver@example.com",
      passwordHash: "argon:correct horse battery",
      verificationTokenHash: "a".repeat(64),
      verificationExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      legalRevision: "2026-08-24",
    });
    expect(email.sendVerification).toHaveBeenCalledWith({
      to: "driver@example.com",
      token: "raw-verification-token",
    });
    expect(JSON.stringify(accountStore.registerPendingAccount.mock.calls)).not.toContain("raw-verification-token");
    expect(base.hashPassword).toHaveBeenCalledWith("correct horse battery");
    expect(accountStore.takeRateLimitAttempt).toHaveBeenCalledTimes(2);
  });

  test("returns the same accepted result for unavailable accounts and delivery failures", async () => {
    const unavailable = dependencies();
    unavailable.accountStore.registerPendingAccount.mockRejectedValueOnce(
      new AccountRegistrationUnavailableError(),
    );
    const failedDelivery = dependencies();
    failedDelivery.email.sendVerification.mockRejectedValueOnce(new Error("redacted delivery failure"));

    const input = {
      email: "driver@example.com",
      password: "correct horse battery",
      ipKeyHash,
      accountKeyHash,
      legalRevision: "2026-08-24",
    };
    await expect(unavailable.service.register(input)).resolves.toEqual({ kind: "accepted" });
    await expect(failedDelivery.service.register(input)).resolves.toEqual({ kind: "accepted" });
    expect(unavailable.email.sendVerification).not.toHaveBeenCalled();
  });

  test("rotates and retries verification delivery without revealing account eligibility", async () => {
    const eligible = dependencies();
    const ineligible = dependencies();
    ineligible.accountStore.createOrRotateActionToken.mockResolvedValueOnce(null);
    const input = { email: " DRIVER@example.com ", ipKeyHash, accountKeyHash };

    await expect(eligible.service.resendVerification(input)).resolves.toEqual({ kind: "accepted" });
    await expect(ineligible.service.resendVerification(input)).resolves.toEqual({ kind: "accepted" });
    expect(eligible.accountStore.createOrRotateActionToken).toHaveBeenCalledWith({
      email: "driver@example.com",
      kind: "verify_email",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-08-25T12:00:00.000Z"),
      now,
    });
    expect(eligible.email.sendVerification).toHaveBeenCalledWith({
      to: "driver@example.com",
      token: "raw-verification-token",
    });
    expect(ineligible.email.sendVerification).not.toHaveBeenCalled();
  });

  test("consumes only a live verification-purpose token without returning private account fields", async () => {
    const success = dependencies();
    const invalid = dependencies();
    invalid.accountStore.consumeActionToken.mockResolvedValueOnce(null);

    await expect(success.service.verifyEmail({ token: "raw-link-token" }))
      .resolves.toEqual({ kind: "verified" });
    await expect(invalid.service.verifyEmail({ token: "expired-replayed-or-wrong-purpose" }))
      .resolves.toEqual({ kind: "invalid" });
    expect(success.accountStore.consumeActionToken).toHaveBeenCalledWith({
      kind: "verify_email",
      tokenHash: "hashed:raw-link-token",
      now,
    });
  });

  test("performs dummy password verification and returns one invalid result for unknown accounts", async () => {
    const { service, accountStore, base, authStore } = dependencies();
    accountStore.findPasswordSignIn.mockResolvedValueOnce(null);

    await expect(service.signInPassword({
      email: "unknown@example.com",
      password: "correct horse battery",
      ipKeyHash,
      accountKeyHash,
    })).resolves.toEqual({ kind: "invalid" });
    expect(base.verifyPassword).toHaveBeenCalledWith("dummy-argon-hash", "correct horse battery");
    expect(authStore.createSession).not.toHaveBeenCalled();
  });

  test("stores only a hashed seven-day session and returns the raw token only to the route", async () => {
    const { service, authStore } = dependencies();

    await expect(service.signInPassword({
      email: " DRIVER@example.com ",
      password: "correct horse battery",
      ipKeyHash,
      accountKeyHash,
    })).resolves.toEqual({
      kind: "authenticated",
      token: "raw-browser-session-token",
      expiresAt: new Date("2026-08-31T12:00:00.000Z"),
    });
    expect(authStore.createSession).toHaveBeenCalledWith({
      userId,
      tokenHash: "d".repeat(64),
      expiresAt: new Date("2026-08-31T12:00:00.000Z"),
      lastSeenAt: now,
    });
    expect(JSON.stringify((authStore.createSession as ReturnType<typeof vi.fn>).mock.calls))
      .not.toContain("raw-browser-session-token");
  });

  test("returns a generic rate-limited result before account lookup", async () => {
    const { service, accountStore, base } = dependencies();
    accountStore.takeRateLimitAttempt.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 60_000 });

    await expect(service.signInPassword({
      email: "driver@example.com",
      password: "correct horse battery",
      ipKeyHash,
      accountKeyHash,
    })).resolves.toEqual({ kind: "rate_limited" });
    expect(accountStore.findPasswordSignIn).not.toHaveBeenCalled();
    expect(base.verifyPassword).not.toHaveBeenCalled();
  });
});
