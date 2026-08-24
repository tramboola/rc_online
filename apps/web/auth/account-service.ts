import type { AccountStore } from "./account-store";
import type { AuthStore } from "./auth-store";
import { AccountRegistrationUnavailableError } from "./postgres-account-store";
import {
  TransactionalEmailError,
  type TransactionalEmail,
  type TransactionalEmailTemplateKind,
} from "./transactional-email";

export const accountPolicies = {
  verificationTtlMs: 24 * 60 * 60 * 1_000,
  passwordResetTtlMs: 30 * 60 * 1_000,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1_000,
  registration: { limit: 5, windowMs: 60 * 60 * 1_000 },
  signIn: { limit: 10, windowMs: 15 * 60 * 1_000 },
  resend: { limit: 3, windowMs: 60 * 60 * 1_000 },
} as const;

type AccountToken = { raw: string; hash: string };
type RateLimitedInput = {
  ipKeyHash: string;
  accountKeyHash: string;
};

export type DeliveryStatusClass =
  | "success"
  | "network"
  | "4xx"
  | "5xx"
  | "other";

export type AccountDeliverySignal = {
  templateKind: TransactionalEmailTemplateKind;
  outcome: "success" | "failure";
  statusClass: DeliveryStatusClass;
};

type AccountServiceDependencies = {
  accountStore: AccountStore;
  authStore: Pick<AuthStore, "createSession">;
  email: TransactionalEmail;
  now(): Date;
  createAccountToken(): AccountToken;
  hashAccountToken(raw: string): string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(hash: string, password: string): Promise<{
    valid: boolean;
    needsRehash: boolean;
  }>;
  dummyPasswordHash: string;
  createSessionToken(): string;
  hashSessionToken(raw: string): string;
  scheduleAfterResponse(task: () => Promise<void>): void;
  reportDelivery(signal: AccountDeliverySignal): void | Promise<void>;
};

export type GenericAccountResult =
  | { kind: "accepted" }
  | { kind: "rate_limited" };

export type VerifyEmailResult =
  | { kind: "verified" }
  | { kind: "invalid" };

export type PasswordSignInResult =
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "authenticated"; token: string; expiresAt: Date };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAccountService(dependencies: AccountServiceDependencies) {
  async function safelyReportDelivery(signal: AccountDeliverySignal): Promise<void> {
    try {
      await dependencies.reportDelivery(signal);
    } catch {
      // Operational reporting must never reject a retained delivery task.
    }
  }

  function deliveryFailureClass(error: unknown): DeliveryStatusClass {
    if (!(error instanceof TransactionalEmailError)) return "other";
    if (error.status === undefined) return "network";
    if (error.status >= 400 && error.status < 500) return "4xx";
    if (error.status >= 500 && error.status < 600) return "5xx";
    return "other";
  }

  function scheduleVerificationWork(
    resolveInput: () => Promise<{ to: string; token: string } | null>,
  ): void {
    dependencies.scheduleAfterResponse(async () => {
      let input: { to: string; token: string } | null;
      try {
        input = await resolveInput();
      } catch {
        await safelyReportDelivery({
          templateKind: "verification",
          outcome: "failure",
          statusClass: "other",
        });
        return;
      }
      if (!input) return;
      try {
        await dependencies.email.sendVerification(input);
        await safelyReportDelivery({
          templateKind: "verification",
          outcome: "success",
          statusClass: "success",
        });
      } catch (error) {
        await safelyReportDelivery({
          templateKind: "verification",
          outcome: "failure",
          statusClass: deliveryFailureClass(error),
        });
      }
    });
  }

  async function passesRateLimit(
    kind: "registration" | "sign_in" | "resend",
    policy: { limit: number; windowMs: number },
    input: RateLimitedInput,
    now: Date,
  ): Promise<boolean> {
    const attempts = await Promise.all([
      dependencies.accountStore.takeRateLimitAttempt({
        keyHash: input.ipKeyHash,
        kind,
        now,
        ...policy,
      }),
      dependencies.accountStore.takeRateLimitAttempt({
        keyHash: input.accountKeyHash,
        kind,
        now,
        ...policy,
      }),
    ]);
    return attempts.every(({ allowed }) => allowed);
  }

  return {
    async register(input: {
      email: string;
      password: string;
      legalRevision: string;
    } & RateLimitedInput): Promise<GenericAccountResult> {
      const now = dependencies.now();
      if (!await passesRateLimit("registration", accountPolicies.registration, input, now)) {
        return { kind: "rate_limited" };
      }
      const email = normalizeEmail(input.email);
      const legalRevision = input.legalRevision;
      const passwordHash = await dependencies.hashPassword(input.password);
      const token = dependencies.createAccountToken();
      scheduleVerificationWork(async () => {
        try {
          const account = await dependencies.accountStore.registerPendingAccount({
            email,
            passwordHash,
            verificationTokenHash: token.hash,
            verificationExpiresAt: new Date(now.getTime() + accountPolicies.verificationTtlMs),
            legalRevision,
          });
          return { to: account.email, token: token.raw };
        } catch (error) {
          if (error instanceof AccountRegistrationUnavailableError) return null;
          throw error;
        }
      });
      return { kind: "accepted" };
    },

    async resendVerification(input: {
      email: string;
    } & RateLimitedInput): Promise<GenericAccountResult> {
      const now = dependencies.now();
      if (!await passesRateLimit("resend", accountPolicies.resend, input, now)) {
        return { kind: "rate_limited" };
      }
      const email = normalizeEmail(input.email);
      const token = dependencies.createAccountToken();
      scheduleVerificationWork(async () => {
        const account = await dependencies.accountStore.createOrRotateActionToken({
          email,
          kind: "verify_email",
          tokenHash: token.hash,
          expiresAt: new Date(now.getTime() + accountPolicies.verificationTtlMs),
          now,
        });
        return account ? { to: account.email, token: token.raw } : null;
      });
      return { kind: "accepted" };
    },

    async verifyEmail(input: { token: string }): Promise<VerifyEmailResult> {
      const account = await dependencies.accountStore.consumeActionToken({
        kind: "verify_email",
        tokenHash: dependencies.hashAccountToken(input.token),
        now: dependencies.now(),
      });
      return account ? { kind: "verified" } : { kind: "invalid" };
    },

    async signInPassword(input: {
      email: string;
      password: string;
    } & RateLimitedInput): Promise<PasswordSignInResult> {
      const now = dependencies.now();
      if (!await passesRateLimit("sign_in", accountPolicies.signIn, input, now)) {
        return { kind: "rate_limited" };
      }
      const email = normalizeEmail(input.email);
      const candidate = await dependencies.accountStore.findPasswordSignIn(email);
      const checkedHash = candidate?.passwordHash ?? dependencies.dummyPasswordHash;
      const password = await dependencies.verifyPassword(checkedHash, input.password);
      if (!candidate || !password.valid) {
        return { kind: "invalid" };
      }

      const rawToken = dependencies.createSessionToken();
      const expiresAt = new Date(now.getTime() + accountPolicies.sessionTtlMs);
      await dependencies.authStore.createSession({
        userId: candidate.userId,
        tokenHash: dependencies.hashSessionToken(rawToken),
        expiresAt,
        lastSeenAt: now,
      });
      return { kind: "authenticated", token: rawToken, expiresAt };
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
