import { createHash } from "node:crypto";

import { after as nextAfter } from "next/server";

import {
  createAccountService,
  type AccountDeliverySignal,
  type AccountService,
} from "./account-service";
import type { AccountStore } from "./account-store";
import { createAccountToken, hashAccountToken } from "./account-token";
import type { AuthStore } from "./auth-store";
import {
  readAuthRuntimeEnvironment,
  type AuthRuntimeEnvironment,
} from "./config";
import { hashPassword, verifyPassword } from "./password";
import { createPostgresAccountStore } from "./postgres-account-store";
import { createPostgresAuthStore } from "./postgres-auth-store";
import { hashSessionToken } from "./session-token";
import {
  createResendTransactionalEmail,
  type ResendTransactionalEmailConfig,
  type TransactionalEmail,
} from "./transactional-email";

const dummyPassword = "RC Mania dummy credential";

export type AccountRuntime = {
  accountStore: AccountStore;
  service: AccountService;
  canonicalOrigin: string;
  rateLimitSecret: string;
};

export type AccountRuntimeFactoryDependencies = {
  createAccountStore(databaseUrl: string): AccountStore;
  createAuthStore(databaseUrl: string): AuthStore;
  createEmail(config: ResendTransactionalEmailConfig): TransactionalEmail;
  hashDummyPassword(password: string): Promise<string>;
  scheduleAfterResponse(task: () => Promise<void>): void;
  scheduleCleanup(task: () => Promise<void>, delayMs: number): void;
  reportDelivery(signal: AccountDeliverySignal): void | Promise<void>;
  reportCleanupFailure(): void;
};

const accountCleanupBatchSize = 100;
const maxCleanupBatchesPerSweep = 10;
const accountCleanupIntervalMs = 60 * 60 * 1_000;
const accountCleanupRetryMs = 5 * 60 * 1_000;

function runtimeIdentity(environment: AuthRuntimeEnvironment): string {
  const serialized = JSON.stringify([
    environment.databaseUrl,
    environment.authUrl,
    environment.authRateLimitSecret,
    environment.authSecret,
    environment.googleClientId,
    environment.googleClientSecret,
    environment.resendApiKey,
    environment.authEmailFrom,
    environment.authSupportEmail,
  ]);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export function createAccountRuntimeFactory(
  dependencies: AccountRuntimeFactoryDependencies,
) {
  const runtimeCache = new Map<string, Promise<AccountRuntime>>();
  let dummyPasswordHash: Promise<string> | undefined;

  return async function createRuntime(
    environmentSource: Record<string, string | undefined> = process.env,
  ): Promise<AccountRuntime> {
    const environment = readAuthRuntimeEnvironment(environmentSource);
    if (!environment.resendApiKey || !environment.authEmailFrom || !environment.authSupportEmail) {
      throw new Error("Transactional account service is unavailable");
    }
    const resendApiKey = environment.resendApiKey;
    const authEmailFrom = environment.authEmailFrom;
    const authSupportEmail = environment.authSupportEmail;
    const identity = runtimeIdentity(environment);
    const cached = runtimeCache.get(identity);
    if (cached) return cached;

    const runtime = (async () => {
      dummyPasswordHash ??= dependencies.hashDummyPassword(dummyPassword);
      let resolvedDummyHash: string;
      try {
        resolvedDummyHash = await dummyPasswordHash;
      } catch (error) {
        dummyPasswordHash = undefined;
        throw error;
      }
      const accountStore = dependencies.createAccountStore(environment.databaseUrl);
      let nextCleanupDelayMs = accountCleanupIntervalMs;
      try {
        await cleanupExpiredAccountData(accountStore);
      } catch {
        dependencies.reportCleanupFailure();
        nextCleanupDelayMs = accountCleanupRetryMs;
      }
      scheduleAccountCleanup(
        accountStore,
        nextCleanupDelayMs,
        dependencies,
        nextCleanupDelayMs === accountCleanupRetryMs
          ? accountCleanupRetryMs * 2
          : accountCleanupRetryMs,
      );
      return {
        accountStore,
        canonicalOrigin: environment.authUrl,
        rateLimitSecret: environment.authRateLimitSecret,
        service: createAccountService({
          accountStore,
          authStore: dependencies.createAuthStore(environment.databaseUrl),
          email: dependencies.createEmail({
            apiKey: resendApiKey,
            authUrl: environment.authUrl,
            from: authEmailFrom,
            supportEmail: authSupportEmail,
          }),
          now: () => new Date(),
          createAccountToken,
          hashAccountToken,
          hashPassword,
          verifyPassword,
          dummyPasswordHash: resolvedDummyHash,
          createSessionToken: () => createAccountToken().raw,
          hashSessionToken,
          scheduleAfterResponse: dependencies.scheduleAfterResponse,
          reportDelivery: dependencies.reportDelivery,
        }),
      };
    })();
    runtimeCache.set(identity, runtime);
    try {
      return await runtime;
    } catch (error) {
      if (runtimeCache.get(identity) === runtime) runtimeCache.delete(identity);
      throw error;
    }
  };
}

async function cleanupExpiredAccountData(accountStore: AccountStore): Promise<void> {
  for (let batch = 0; batch < maxCleanupBatchesPerSweep; batch += 1) {
    const result = await accountStore.cleanupExpiredAccountData({
      now: new Date(),
      batchSize: accountCleanupBatchSize,
    });
    if (
      result.tokensDeleted < accountCleanupBatchSize
      && result.rateLimitRowsDeleted < accountCleanupBatchSize
      && result.accountsDeleted < accountCleanupBatchSize
    ) {
      return;
    }
  }
}

function scheduleAccountCleanup(
  accountStore: AccountStore,
  delayMs: number,
  dependencies: AccountRuntimeFactoryDependencies,
  failureRetryMs: number,
): void {
  dependencies.scheduleCleanup(async () => {
    let nextDelayMs = accountCleanupIntervalMs;
    let nextFailureRetryMs = accountCleanupRetryMs;
    try {
      await cleanupExpiredAccountData(accountStore);
    } catch {
      dependencies.reportCleanupFailure();
      nextDelayMs = failureRetryMs;
      nextFailureRetryMs = Math.min(failureRetryMs * 2, accountCleanupIntervalMs);
    }
    scheduleAccountCleanup(accountStore, nextDelayMs, dependencies, nextFailureRetryMs);
  }, delayMs);
}

function reportAccountDelivery(signal: AccountDeliverySignal): void {
  console.info("account_email_delivery", signal);
}

function reportAccountCleanupFailure(): void {
  console.warn("account_data_cleanup_failed");
}

export const createAccountRuntime = createAccountRuntimeFactory({
  createAccountStore: createPostgresAccountStore,
  createAuthStore: createPostgresAuthStore,
  createEmail: createResendTransactionalEmail,
  hashDummyPassword: hashPassword,
  scheduleAfterResponse: (task) => nextAfter(task),
  scheduleCleanup: (task, delayMs) => {
    const timeout = setTimeout(() => {
      void task();
    }, delayMs);
    timeout.unref();
  },
  reportDelivery: reportAccountDelivery,
  reportCleanupFailure: reportAccountCleanupFailure,
});
