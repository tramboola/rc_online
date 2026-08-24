import { describe, expect, test, vi } from "vitest";

import { createAccountRuntimeFactory } from "./account-runtime";

const environment = {
  NODE_ENV: "production",
  AUTH_SECRET: "a".repeat(32),
  AUTH_RATE_LIMIT_SECRET: "ab".repeat(32),
  AUTH_URL: "https://rcmania.live",
  DATABASE_URL: "postgresql://account-runtime-one",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  RESEND_API_KEY: "resend-key-one",
  AUTH_EMAIL_FROM: "RC Mania <accounts@updates.rcmania.live>",
  AUTH_SUPPORT_EMAIL: "support@rcmania.live",
} satisfies Record<string, string>;

function runtimeFactory() {
  const accountStore = {
    cleanupExpiredAccountData: vi.fn(async () => ({
      tokensDeleted: 0,
      rateLimitRowsDeleted: 0,
      accountsDeleted: 0,
    })),
  } as never;
  const factories = {
    createAccountStore: vi.fn(() => accountStore),
    createAuthStore: vi.fn(() => ({}) as never),
    createEmail: vi.fn(() => ({}) as never),
    hashDummyPassword: vi.fn(async () => "dummy-argon-hash"),
    scheduleAfterResponse: vi.fn(() => undefined),
    scheduleCleanup: vi.fn((_task: () => Promise<void>, _delayMs: number) => undefined),
    reportDelivery: vi.fn(async () => undefined),
    reportCleanupFailure: vi.fn(),
  };
  return { createRuntime: createAccountRuntimeFactory(factories), factories, accountStore };
}

describe("account runtime cache", () => {
  test("reuses one in-flight runtime, service, and pair of stores for identical configuration", async () => {
    const { createRuntime, factories, accountStore } = runtimeFactory();

    const [first, second] = await Promise.all([
      createRuntime(environment),
      createRuntime({ ...environment }),
    ]);

    expect(second).toBe(first);
    expect(first.accountStore).toBe(accountStore);
    expect(second.accountStore).toBe(accountStore);
    expect(factories.createAccountStore).toHaveBeenCalledTimes(1);
    expect(factories.createAuthStore).toHaveBeenCalledTimes(1);
    expect(factories.createEmail).toHaveBeenCalledTimes(1);
    expect(factories.hashDummyPassword).toHaveBeenCalledTimes(1);
    expect((accountStore as { cleanupExpiredAccountData: ReturnType<typeof vi.fn> }).cleanupExpiredAccountData)
      .toHaveBeenCalledTimes(1);
    expect(factories.scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1_000);
  });

  test("keeps account runtime available and schedules a bounded retry when startup cleanup fails", async () => {
    const { createRuntime, factories, accountStore } = runtimeFactory();
    const cleanup = (accountStore as { cleanupExpiredAccountData: ReturnType<typeof vi.fn> })
      .cleanupExpiredAccountData;
    cleanup.mockRejectedValueOnce(new Error("database cleanup unavailable"));

    await expect(createRuntime(environment)).resolves.toBeDefined();
    expect(factories.reportCleanupFailure).toHaveBeenCalledOnce();
    expect(factories.reportCleanupFailure).toHaveBeenCalledWith();
    expect(factories.scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1_000);
  });

  test("drains a bounded cleanup backlog before scheduling the next sweep", async () => {
    const { createRuntime, factories, accountStore } = runtimeFactory();
    const cleanup = (accountStore as { cleanupExpiredAccountData: ReturnType<typeof vi.fn> })
      .cleanupExpiredAccountData;
    cleanup
      .mockResolvedValueOnce({ tokensDeleted: 100, rateLimitRowsDeleted: 0, accountsDeleted: 0 })
      .mockResolvedValueOnce({ tokensDeleted: 0, rateLimitRowsDeleted: 0, accountsDeleted: 0 });

    await createRuntime(environment);

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(factories.scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1_000);
  });

  test("runs cleanup again after the scheduled interval and schedules the following sweep", async () => {
    const { createRuntime, factories, accountStore } = runtimeFactory();
    const cleanup = (accountStore as { cleanupExpiredAccountData: ReturnType<typeof vi.fn> })
      .cleanupExpiredAccountData;
    await createRuntime(environment);
    const scheduledSweep = factories.scheduleCleanup.mock.calls[0]?.[0];
    expect(scheduledSweep).toEqual(expect.any(Function));

    await scheduledSweep?.();

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(factories.scheduleCleanup).toHaveBeenCalledTimes(2);
    expect(factories.scheduleCleanup).toHaveBeenLastCalledWith(expect.any(Function), 60 * 60 * 1_000);
  });

  test("backs off repeated cleanup failures without making the account runtime unavailable", async () => {
    const { createRuntime, factories, accountStore } = runtimeFactory();
    const cleanup = (accountStore as { cleanupExpiredAccountData: ReturnType<typeof vi.fn> })
      .cleanupExpiredAccountData;
    cleanup.mockRejectedValue(new Error("database cleanup unavailable"));

    await expect(createRuntime(environment)).resolves.toBeDefined();
    const firstRetry = factories.scheduleCleanup.mock.calls[0]?.[0];
    await firstRetry?.();

    expect(factories.reportCleanupFailure).toHaveBeenCalledTimes(2);
    expect(factories.scheduleCleanup).toHaveBeenNthCalledWith(1, expect.any(Function), 5 * 60 * 1_000);
    expect(factories.scheduleCleanup).toHaveBeenNthCalledWith(2, expect.any(Function), 10 * 60 * 1_000);
  });

  test("does not share pools or services across a different relevant runtime identity", async () => {
    const { createRuntime, factories } = runtimeFactory();

    const first = await createRuntime(environment);
    const changedDatabase = await createRuntime({
      ...environment,
      DATABASE_URL: "postgresql://account-runtime-two",
    });
    const changedEmail = await createRuntime({
      ...environment,
      AUTH_EMAIL_FROM: "RC Mania <accounts@other.rcmania.live>",
    });

    expect(changedDatabase).not.toBe(first);
    expect(changedEmail).not.toBe(first);
    expect(factories.createAccountStore).toHaveBeenCalledTimes(3);
    expect(factories.createAuthStore).toHaveBeenCalledTimes(3);
    expect(factories.createEmail).toHaveBeenCalledTimes(3);
  });
});
