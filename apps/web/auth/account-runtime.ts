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
  reportDelivery(signal: AccountDeliverySignal): void | Promise<void>;
};

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

function reportAccountDelivery(signal: AccountDeliverySignal): void {
  console.info("account_email_delivery", signal);
}

export const createAccountRuntime = createAccountRuntimeFactory({
  createAccountStore: createPostgresAccountStore,
  createAuthStore: createPostgresAuthStore,
  createEmail: createResendTransactionalEmail,
  hashDummyPassword: hashPassword,
  scheduleAfterResponse: (task) => nextAfter(task),
  reportDelivery: reportAccountDelivery,
});
