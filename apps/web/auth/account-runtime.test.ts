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
  const accountStore = {} as never;
  const factories = {
    createAccountStore: vi.fn(() => accountStore),
    createAuthStore: vi.fn(() => ({}) as never),
    createEmail: vi.fn(() => ({}) as never),
    hashDummyPassword: vi.fn(async () => "dummy-argon-hash"),
    scheduleAfterResponse: vi.fn(() => undefined),
    reportDelivery: vi.fn(async () => undefined),
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
