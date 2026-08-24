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
  passwordResetRequest: { limit: 3, windowMs: 60 * 60 * 1_000 },
  passwordResetSubmit: { limit: 5, windowMs: 15 * 60 * 1_000 },
  deletion: { limit: 3, windowMs: 15 * 60 * 1_000 },
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

export type ResetPasswordResult =
  | { kind: "reset" }
  | { kind: "invalid" }
  | { kind: "rate_limited" };

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

  function scheduleDeliveryWork(
    templateKind: TransactionalEmailTemplateKind,
    work: () => Promise<boolean>,
  ): void {
    dependencies.scheduleAfterResponse(async () => {
      try {
        const delivered = await work();
        if (!delivered) return;
        await safelyReportDelivery({
          templateKind,
          outcome: "success",
          statusClass: "success",
        });
      } catch (error) {
        await safelyReportDelivery({
          templateKind,
          outcome: "failure",
          statusClass: deliveryFailureClass(error),
        });
      }
    });
  }

  function scheduleBestEffortDeliveryWork(
    templateKind: TransactionalEmailTemplateKind,
    work: () => Promise<boolean>,
  ): void {
    try {
      scheduleDeliveryWork(templateKind, work);
    } catch {
      void safelyReportDelivery({
        templateKind,
        outcome: "failure",
        statusClass: "other",
      });
    }
  }

  async function passesRateLimit(
    kind:
      | "registration"
      | "sign_in"
      | "resend"
      | "password_reset_request"
      | "password_reset_submit"
      | "deletion",
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
      scheduleDeliveryWork("verification", async () => {
        try {
          const account = await dependencies.accountStore.registerPendingAccount({
            email,
            passwordHash,
            verificationTokenHash: token.hash,
            verificationExpiresAt: new Date(now.getTime() + accountPolicies.verificationTtlMs),
            legalRevision,
          });
          await dependencies.email.sendVerification({ to: account.email, token: token.raw });
          return true;
        } catch (error) {
          if (error instanceof AccountRegistrationUnavailableError) return false;
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
      scheduleDeliveryWork("verification", async () => {
        const account = await dependencies.accountStore.createOrRotateActionToken({
          email,
          kind: "verify_email",
          tokenHash: token.hash,
          expiresAt: new Date(now.getTime() + accountPolicies.verificationTtlMs),
          now,
        });
        if (!account) return false;
        await dependencies.email.sendVerification({ to: account.email, token: token.raw });
        return true;
      });
      return { kind: "accepted" };
    },

    async requestPasswordReset(input: {
      email: string;
    } & RateLimitedInput): Promise<GenericAccountResult> {
      const now = dependencies.now();
      if (!await passesRateLimit(
        "password_reset_request",
        accountPolicies.passwordResetRequest,
        input,
        now,
      )) {
        return { kind: "rate_limited" };
      }
      const email = normalizeEmail(input.email);
      const token = dependencies.createAccountToken();
      scheduleDeliveryWork("password_reset", async () => {
        const account = await dependencies.accountStore.createOrRotateActionToken({
          email,
          kind: "reset_password",
          tokenHash: token.hash,
          expiresAt: new Date(now.getTime() + accountPolicies.passwordResetTtlMs),
          now,
        });
        if (!account) return false;
        await dependencies.email.sendPasswordReset({ to: account.email, token: token.raw });
        return true;
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

    async resetPassword(input: {
      token: string;
      password: string;
    } & RateLimitedInput): Promise<ResetPasswordResult> {
      const now = dependencies.now();
      if (!await passesRateLimit(
        "password_reset_submit",
        accountPolicies.passwordResetSubmit,
        input,
        now,
      )) {
        return { kind: "rate_limited" };
      }
      const newPasswordHash = await dependencies.hashPassword(input.password);
      const account = await dependencies.accountStore.replacePasswordAndRevokeSessions({
        resetTokenHash: dependencies.hashAccountToken(input.token),
        newPasswordHash,
        now,
      });
      if (!account) {
        return { kind: "invalid" };
      }
      scheduleDeliveryWork("password_changed", async () => {
        await dependencies.email.sendPasswordChanged({ to: account.email });
        return true;
      });
      return { kind: "reset" };
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

    async deleteAccount(input: {
      authenticatedSubject: string;
    } & RateLimitedInput): Promise<
      | { kind: "deleted" }
      | { kind: "rate_limited" }
      | { kind: "unavailable" }
    > {
      const now = dependencies.now();
      if (!await passesRateLimit("deletion", accountPolicies.deletion, input, now)) {
        return { kind: "rate_limited" };
      }

      const ownProfile = await dependencies.accountStore.getOwnProfile(
        input.authenticatedSubject,
      );
      if (!ownProfile) return { kind: "unavailable" };
      const ownEmail = ownProfile.email;

      const deleted = await dependencies.accountStore.deleteOwnAccount(
        input.authenticatedSubject,
      );
      if (!deleted) return { kind: "unavailable" };

      scheduleBestEffortDeliveryWork("account_deleted", async () => {
        await dependencies.email.sendAccountDeleted({ to: ownEmail });
        return true;
      });
      return { kind: "deleted" };
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
