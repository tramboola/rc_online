import { createAccountService, type AccountService } from "./account-service";
import { createAccountToken, hashAccountToken } from "./account-token";
import { readAuthRuntimeEnvironment } from "./config";
import { hashPassword, verifyPassword } from "./password";
import { createPostgresAccountStore } from "./postgres-account-store";
import { createPostgresAuthStore } from "./postgres-auth-store";
import { hashSessionToken } from "./session-token";
import { createResendTransactionalEmail } from "./transactional-email";

const dummyPassword = "RC Mania dummy credential";
let dummyPasswordHash: Promise<string> | undefined;

export type AccountRuntime = {
  service: AccountService;
  canonicalOrigin: string;
  rateLimitSecret: string;
};

export async function createAccountRuntime(
  environmentSource: Record<string, string | undefined> = process.env,
): Promise<AccountRuntime> {
  const environment = readAuthRuntimeEnvironment(environmentSource);
  if (!environment.resendApiKey || !environment.authEmailFrom || !environment.authSupportEmail) {
    throw new Error("Transactional account service is unavailable");
  }
  dummyPasswordHash ??= hashPassword(dummyPassword);
  const resolvedDummyHash = await dummyPasswordHash;
  return {
    canonicalOrigin: environment.authUrl,
    rateLimitSecret: environment.authRateLimitSecret,
    service: createAccountService({
      accountStore: createPostgresAccountStore(environment.databaseUrl),
      authStore: createPostgresAuthStore(environment.databaseUrl),
      email: createResendTransactionalEmail({
        apiKey: environment.resendApiKey,
        authUrl: environment.authUrl,
        from: environment.authEmailFrom,
        supportEmail: environment.authSupportEmail,
      }),
      now: () => new Date(),
      createAccountToken,
      hashAccountToken,
      hashPassword,
      verifyPassword,
      dummyPasswordHash: resolvedDummyHash,
      createSessionToken: () => createAccountToken().raw,
      hashSessionToken,
    }),
  };
}
