import type {
  AccountActionTokenKind,
  AuthRateLimitKind,
} from "@rc/database";

export type AvatarKey = string;

export type OwnProfile = {
  email: string;
  nickname: string;
  avatarKey: AvatarKey;
};

export type PendingAccountRegistration = {
  email: string;
  passwordHash: string;
  verificationTokenHash: string;
  verificationExpiresAt: Date;
  legalRevision: string;
};

export type AccountActionResult = {
  userId: string;
  email: string;
};

export type PasswordSignInCandidate = AccountActionResult & {
  passwordHash: string;
};

export type RateLimitAttempt = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type AccountCleanupResult = {
  tokensDeleted: number;
  rateLimitRowsDeleted: number;
  accountsDeleted: number;
};

export interface AccountStore {
  registerPendingAccount(input: PendingAccountRegistration): Promise<AccountActionResult>;
  consumeActionToken(input: {
    kind: AccountActionTokenKind;
    tokenHash: string;
    now: Date;
  }): Promise<AccountActionResult | null>;
  findPasswordSignIn(email: string): Promise<PasswordSignInCandidate | null>;
  replacePasswordAndRevokeSessions(input: {
    resetTokenHash: string;
    newPasswordHash: string;
    now: Date;
  }): Promise<AccountActionResult | null>;
  getOwnProfile(authenticatedSubject: string): Promise<OwnProfile | null>;
  updateOwnProfile(
    authenticatedSubject: string,
    profile: Pick<OwnProfile, "nickname" | "avatarKey">,
  ): Promise<OwnProfile | null>;
  deleteOwnAccount(authenticatedSubject: string): Promise<boolean>;
  takeRateLimitAttempt(input: {
    keyHash: string;
    kind: AuthRateLimitKind;
    now: Date;
    windowMs: number;
    limit: number;
  }): Promise<RateLimitAttempt>;
  cleanupExpiredAccountData(input: {
    now: Date;
    batchSize: number;
  }): Promise<AccountCleanupResult>;
}
