import { randomUUID } from "node:crypto";

import {
  accountActionTokens,
  accountBalances,
  authRateLimits,
  authSessions,
  consents,
  createDatabase,
  nicknames,
  oauthIdentities,
  passwordCredentials,
  users,
} from "@rc/database";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";

import { createDefaultNickname, defaultAvatarKey } from "./account-profile";
import type {
  AccountActionResult,
  AccountCleanupResult,
  AccountStore,
  OwnProfile,
  PendingAccountRegistration,
  RateLimitAttempt,
} from "./account-store";

const nicknameCreationAttempts = 10;
const minimumCleanupBatchSize = 1;
const maximumCleanupBatchSize = 250;
const deletedEmailDomain = "invalid.rcmania";

type PostgresAccountStoreDependencies = {
  now?: () => Date;
  randomUuid?: () => string;
};

type AccountDatabase = ReturnType<typeof createDatabase>["db"];
type AccountTransaction = Parameters<
  Parameters<AccountDatabase["transaction"]>[0]
>[0];

export class AccountRegistrationUnavailableError extends Error {
  constructor() {
    super("Account registration is unavailable");
    this.name = "AccountRegistrationUnavailableError";
  }
}

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeAccountNickname(nickname: string): string {
  return nickname.normalize("NFKC").trim();
}

export function createPostgresAccountStore(
  databaseUrl: string,
  dependencies: PostgresAccountStoreDependencies = {},
): AccountStore {
  const { db } = createDatabase(databaseUrl);
  const currentTime = dependencies.now ?? (() => new Date());
  const nextUuid = dependencies.randomUuid ?? randomUUID;

  async function loadOwnProfile(
    executor: Pick<AccountTransaction, "select">,
    authenticatedSubject: string,
  ): Promise<OwnProfile | null> {
    const [row] = await executor.select({
      email: users.email,
      nickname: nicknames.nickname,
      avatarKey: nicknames.avatarKey,
    }).from(users)
      .innerJoin(nicknames, eq(nicknames.userId, users.id))
      .where(and(
        eq(users.id, authenticatedSubject),
        isNull(users.disabledAt),
      ))
      .limit(1);

    return row ? {
      email: row.email,
      nickname: row.nickname,
      avatarKey: row.avatarKey,
    } : null;
  }

  async function insertLegalNotices(
    transaction: AccountTransaction,
    userId: string,
    legalRevision: string,
    occurredAt: Date,
  ): Promise<void> {
    for (const kind of ["terms_of_service", "privacy_policy_notice"] as const) {
      const [created] = await transaction.insert(consents).values({
        userId,
        kind,
        documentVersion: legalRevision,
        accepted: true,
        occurredAt,
        evidence: { presentation: "registration_notice" },
      }).onConflictDoNothing().returning({ id: consents.id });
      if (!created) {
        // A retry can encounter an existing legal notice for this revision.
        continue;
      }
    }
  }

  async function insertVerificationToken(
    transaction: AccountTransaction,
    userId: string,
    input: PendingAccountRegistration,
    createdAt: Date,
  ): Promise<void> {
    const [created] = await transaction.insert(accountActionTokens).values({
      userId,
      kind: "verify_email",
      tokenHash: input.verificationTokenHash,
      expiresAt: input.verificationExpiresAt,
      consumedAt: null,
      createdAt,
    }).returning({ id: accountActionTokens.id });
    if (!created) {
      throw new Error("Verification token creation returned no row");
    }
  }

  return {
    async registerPendingAccount(input) {
      const email = normalizeAccountEmail(input.email);
      const occurredAt = currentTime();

      try {
        return await db.transaction(async (transaction): Promise<AccountActionResult> => {
          const [existingUser] = await transaction.select({
            id: users.id,
            email: users.email,
            disabledAt: users.disabledAt,
          }).from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);

          if (existingUser) {
            if (existingUser.disabledAt) {
              throw new AccountRegistrationUnavailableError();
            }
            const [credential] = await transaction.select({
              userId: passwordCredentials.userId,
            }).from(passwordCredentials)
              .where(eq(passwordCredentials.userId, existingUser.id))
              .limit(1);
            if (credential) {
              throw new AccountRegistrationUnavailableError();
            }
            const [googleIdentity] = await transaction.select({
              id: oauthIdentities.id,
            }).from(oauthIdentities)
              .where(and(
                eq(oauthIdentities.userId, existingUser.id),
                eq(oauthIdentities.provider, "google"),
              ))
              .limit(1);
            if (!googleIdentity) {
              throw new AccountRegistrationUnavailableError();
            }

            const [credentialCreated] = await transaction.insert(passwordCredentials).values({
              userId: existingUser.id,
              passwordHash: input.passwordHash,
              passwordChangedAt: occurredAt,
              verifiedAt: null,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            }).returning({ userId: passwordCredentials.userId });
            if (!credentialCreated) {
              throw new Error("Password credential creation returned no row");
            }
            await insertLegalNotices(transaction, existingUser.id, input.legalRevision, occurredAt);
            await insertVerificationToken(transaction, existingUser.id, input, occurredAt);
            return { userId: existingUser.id, email: normalizeAccountEmail(existingUser.email) };
          }

          const userId = nextUuid();
          const [createdUser] = await transaction.insert(users).values({
            id: userId,
            email,
            displayName: "RC Mania driver",
            role: "user",
            emailVerifiedAt: null,
            disabledAt: null,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          }).returning({ id: users.id, email: users.email });
          if (!createdUser) {
            throw new Error("User creation returned no row");
          }

          const [credentialCreated] = await transaction.insert(passwordCredentials).values({
            userId: createdUser.id,
            passwordHash: input.passwordHash,
            passwordChangedAt: occurredAt,
            verifiedAt: null,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          }).returning({ userId: passwordCredentials.userId });
          if (!credentialCreated) {
            throw new Error("Password credential creation returned no row");
          }
          const [balanceCreated] = await transaction.insert(accountBalances).values({
            userId: createdUser.id,
            currency: "USD",
            amountMinor: 0,
          }).returning({ userId: accountBalances.userId });
          if (!balanceCreated) {
            throw new Error("Account balance creation returned no row");
          }

          let profileCreated = false;
          for (let attempt = 0; attempt < nicknameCreationAttempts; attempt += 1) {
            const nickname = createDefaultNickname(nextUuid());
            const [created] = await transaction.insert(nicknames).values({
              userId: createdUser.id,
              nickname,
              avatarKey: defaultAvatarKey,
            }).onConflictDoNothing().returning({ id: nicknames.id });
            if (created) {
              profileCreated = true;
              break;
            }
          }
          if (!profileCreated) {
            throw new Error("Account profile creation returned no row");
          }

          await insertLegalNotices(transaction, createdUser.id, input.legalRevision, occurredAt);
          await insertVerificationToken(transaction, createdUser.id, input, occurredAt);
          return { userId: createdUser.id, email: normalizeAccountEmail(createdUser.email) };
        });
      } catch (error) {
        if (
          error instanceof AccountRegistrationUnavailableError ||
          (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
        ) {
          throw new AccountRegistrationUnavailableError();
        }
        throw error;
      }
    },

    async consumeActionToken(input) {
      return db.transaction(async (transaction): Promise<AccountActionResult | null> => {
        const [token] = await transaction.update(accountActionTokens).set({
          consumedAt: input.now,
        }).where(and(
          eq(accountActionTokens.tokenHash, input.tokenHash),
          eq(accountActionTokens.kind, input.kind),
          isNull(accountActionTokens.consumedAt),
          gt(accountActionTokens.expiresAt, input.now),
        )).returning({ userId: accountActionTokens.userId });
        if (!token) {
          return null;
        }

        if (input.kind === "verify_email") {
          const [verifiedUser] = await transaction.update(users).set({
            emailVerifiedAt: input.now,
            updatedAt: input.now,
          }).where(and(
            eq(users.id, token.userId),
            isNull(users.disabledAt),
          )).returning({ id: users.id, email: users.email });
          if (!verifiedUser) {
            throw new Error("Verification user is unavailable");
          }
          const [verifiedCredential] = await transaction.update(passwordCredentials).set({
            verifiedAt: input.now,
            updatedAt: input.now,
          }).where(and(
            eq(passwordCredentials.userId, token.userId),
            isNull(passwordCredentials.verifiedAt),
          )).returning({ userId: passwordCredentials.userId });
          if (!verifiedCredential) {
            throw new Error("Verification credential is unavailable");
          }
          return { userId: verifiedUser.id, email: normalizeAccountEmail(verifiedUser.email) };
        }

        const [user] = await transaction.select({
          id: users.id,
          email: users.email,
        }).from(users)
          .where(and(eq(users.id, token.userId), isNull(users.disabledAt)))
          .limit(1);
        return user ? { userId: user.id, email: normalizeAccountEmail(user.email) } : null;
      });
    },

    async createOrRotateActionToken(input) {
      const email = normalizeAccountEmail(input.email);
      return db.transaction(async (transaction): Promise<AccountActionResult | null> => {
        const credentialEligibility = input.kind === "verify_email"
          ? isNull(passwordCredentials.verifiedAt)
          : and(
              isNotNull(passwordCredentials.verifiedAt),
              isNotNull(users.emailVerifiedAt),
            );
        const [eligible] = await transaction.select({
          userId: users.id,
          email: users.email,
        }).from(users)
          .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
          .where(and(
            sql`lower(${users.email}) = ${email}`,
            isNull(users.disabledAt),
            credentialEligibility,
          ))
          .for("update", { of: [users, passwordCredentials] })
          .limit(1);
        if (!eligible) {
          return null;
        }

        await transaction.delete(accountActionTokens).where(and(
          eq(accountActionTokens.userId, eligible.userId),
          eq(accountActionTokens.kind, input.kind),
          isNull(accountActionTokens.consumedAt),
        )).returning({ id: accountActionTokens.id });
        const [created] = await transaction.insert(accountActionTokens).values({
          userId: eligible.userId,
          kind: input.kind,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          consumedAt: null,
          createdAt: input.now,
        }).returning({ id: accountActionTokens.id });
        if (!created) {
          throw new Error("Action token creation returned no row");
        }
        return {
          userId: eligible.userId,
          email: normalizeAccountEmail(eligible.email),
        };
      });
    },

    async findPasswordSignIn(rawEmail) {
      const email = normalizeAccountEmail(rawEmail);
      const [candidate] = await db.select({
        userId: users.id,
        email: users.email,
        passwordHash: passwordCredentials.passwordHash,
      }).from(users)
        .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
        .where(and(
          sql`lower(${users.email}) = ${email}`,
          isNull(users.disabledAt),
          isNotNull(passwordCredentials.verifiedAt),
        ))
        .limit(1);
      return candidate ? {
        userId: candidate.userId,
        email: normalizeAccountEmail(candidate.email),
        passwordHash: candidate.passwordHash,
      } : null;
    },

    async replacePasswordAndRevokeSessions(input) {
      return db.transaction(async (transaction): Promise<AccountActionResult | null> => {
        const [token] = await transaction.update(accountActionTokens).set({
          consumedAt: input.now,
        }).where(and(
          eq(accountActionTokens.tokenHash, input.resetTokenHash),
          eq(accountActionTokens.kind, "reset_password"),
          isNull(accountActionTokens.consumedAt),
          gt(accountActionTokens.expiresAt, input.now),
          sql`exists (
            select 1 from ${users}
            inner join ${passwordCredentials}
              on ${passwordCredentials.userId} = ${users.id}
            where ${users.id} = ${accountActionTokens.userId}
              and ${users.disabledAt} is null
              and ${passwordCredentials.verifiedAt} is not null
          )`,
        )).returning({ userId: accountActionTokens.userId });
        if (!token) {
          return null;
        }

        const [credential] = await transaction.update(passwordCredentials).set({
          passwordHash: input.newPasswordHash,
          passwordChangedAt: input.now,
          updatedAt: input.now,
        }).where(and(
          eq(passwordCredentials.userId, token.userId),
          isNotNull(passwordCredentials.verifiedAt),
        )).returning({ userId: passwordCredentials.userId });
        if (!credential) {
          throw new Error("Reset credential invariant failed");
        }

        await transaction.delete(authSessions)
          .where(eq(authSessions.userId, token.userId))
          .returning({ id: authSessions.id });
        await transaction.delete(accountActionTokens)
          .where(and(
            eq(accountActionTokens.userId, token.userId),
            eq(accountActionTokens.kind, "reset_password"),
          ))
          .returning({ id: accountActionTokens.id });
        const [user] = await transaction.select({
          email: users.email,
        }).from(users)
          .where(and(eq(users.id, token.userId), isNull(users.disabledAt)))
          .limit(1);
        return user ? { userId: token.userId, email: normalizeAccountEmail(user.email) } : null;
      });
    },

    async getOwnProfile(authenticatedSubject) {
      return loadOwnProfile(db, authenticatedSubject);
    },

    async updateOwnProfile(authenticatedSubject, profile) {
      return db.transaction(async (transaction) => {
        const [updated] = await transaction.update(nicknames).set({
          nickname: normalizeAccountNickname(profile.nickname),
          avatarKey: profile.avatarKey,
          updatedAt: currentTime(),
        }).where(and(
          eq(nicknames.userId, authenticatedSubject),
          sql`exists (
            select 1 from ${users}
            where ${users.id} = ${nicknames.userId}
              and ${users.disabledAt} is null
          )`,
        ))
          .returning({ userId: nicknames.userId });
        if (!updated) {
          return null;
        }
        return loadOwnProfile(transaction, authenticatedSubject);
      });
    },

    async deleteOwnAccount(authenticatedSubject) {
      return db.transaction(async (transaction): Promise<boolean> => {
        for (const table of [
          authSessions,
          passwordCredentials,
          accountActionTokens,
          oauthIdentities,
          nicknames,
        ]) {
          await transaction.delete(table)
            .where(eq(table.userId, authenticatedSubject))
            .returning();
        }
        await transaction.delete(consents).where(and(
          eq(consents.userId, authenticatedSubject),
          ne(consents.kind, "terms_of_service"),
        )).returning();

        const disabledAt = currentTime();
        const deletedUuid = nextUuid();
        const [deleted] = await transaction.update(users).set({
          email: `deleted+${deletedUuid}@${deletedEmailDomain}`,
          displayName: "Deleted driver",
          emailVerifiedAt: null,
          disabledAt,
          updatedAt: disabledAt,
        }).where(and(
          eq(users.id, authenticatedSubject),
          isNull(users.disabledAt),
        )).returning({ id: users.id });
        return Boolean(deleted);
      });
    },

    async takeRateLimitAttempt(input): Promise<RateLimitAttempt> {
      if (!/^[a-f0-9]{64}$/i.test(input.keyHash)) {
        throw new Error("Rate-limit key must be an HMAC digest");
      }
      if (!Number.isSafeInteger(input.windowMs) || input.windowMs <= 0) {
        throw new Error("Rate-limit window must be positive");
      }
      if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
        throw new Error("Rate-limit limit must be positive");
      }
      const windowStartedAt = new Date(
        Math.floor(input.now.getTime() / input.windowMs) * input.windowMs,
      );
      const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs);
      const [row] = await db.insert(authRateLimits).values({
        keyHash: input.keyHash.toLowerCase(),
        kind: input.kind,
        windowStartedAt,
        attemptCount: 1,
        expiresAt,
      }).onConflictDoUpdate({
        target: [
          authRateLimits.keyHash,
          authRateLimits.kind,
          authRateLimits.windowStartedAt,
        ],
        set: {
          attemptCount: sql`${authRateLimits.attemptCount} + 1`,
          expiresAt,
        },
      }).returning({ attemptCount: authRateLimits.attemptCount });
      if (!row) {
        throw new Error("Rate-limit attempt returned no row");
      }
      return {
        allowed: row.attemptCount <= input.limit,
        remaining: Math.max(0, input.limit - row.attemptCount),
        retryAfterMs: Math.max(0, expiresAt.getTime() - input.now.getTime()),
      };
    },

    async cleanupExpiredAccountData(input): Promise<AccountCleanupResult> {
      if (!Number.isFinite(input.batchSize)) {
        throw new Error("Cleanup batch size must be finite");
      }
      const batchSize = Math.min(
        maximumCleanupBatchSize,
        Math.max(minimumCleanupBatchSize, Math.floor(input.batchSize)),
      );
      const staleAccountCutoff = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1_000);

      return db.transaction(async (transaction): Promise<AccountCleanupResult> => {
        const expiredTokens = await transaction.select({ id: accountActionTokens.id })
          .from(accountActionTokens)
          .where(lt(accountActionTokens.expiresAt, input.now))
          .limit(batchSize);
        let tokensDeleted = 0;
        if (expiredTokens.length > 0) {
          const deleted = await transaction.delete(accountActionTokens)
            .where(inArray(accountActionTokens.id, expiredTokens.map(({ id }) => id)))
            .returning({ id: accountActionTokens.id });
          tokensDeleted = deleted.length;
        }

        const expiredRateLimits = await transaction.select({
          keyHash: authRateLimits.keyHash,
          kind: authRateLimits.kind,
          windowStartedAt: authRateLimits.windowStartedAt,
        }).from(authRateLimits)
          .where(lt(authRateLimits.expiresAt, input.now))
          .limit(batchSize);
        let rateLimitRowsDeleted = 0;
        for (const row of expiredRateLimits) {
          const deleted = await transaction.delete(authRateLimits).where(and(
            eq(authRateLimits.keyHash, row.keyHash),
            eq(authRateLimits.kind, row.kind),
            eq(authRateLimits.windowStartedAt, row.windowStartedAt),
          )).returning({ keyHash: authRateLimits.keyHash });
          rateLimitRowsDeleted += deleted.length;
        }

        const staleAccounts = await transaction.select({ id: users.id })
          .from(users)
          .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
          .where(and(
            isNull(users.emailVerifiedAt),
            isNull(users.disabledAt),
            isNull(passwordCredentials.verifiedAt),
            lt(users.createdAt, staleAccountCutoff),
            sql`not exists (
              select 1 from ${oauthIdentities}
              where ${oauthIdentities.userId} = ${users.id}
            )`,
          ))
          .for("update", { of: [users, passwordCredentials], skipLocked: true })
          .limit(batchSize);
        const staleIds = staleAccounts.map(({ id }) => id);
        if (staleIds.length > 0) {
          await transaction.delete(authSessions).where(inArray(authSessions.userId, staleIds)).returning();
          await transaction.delete(accountActionTokens).where(inArray(accountActionTokens.userId, staleIds)).returning();
          await transaction.delete(passwordCredentials).where(inArray(passwordCredentials.userId, staleIds)).returning();
          await transaction.delete(nicknames).where(inArray(nicknames.userId, staleIds)).returning();
          await transaction.delete(consents).where(inArray(consents.userId, staleIds)).returning();
          const deletedUsers = await transaction.delete(users)
            .where(inArray(users.id, staleIds))
            .returning({ id: users.id });
          return {
            tokensDeleted,
            rateLimitRowsDeleted,
            accountsDeleted: deletedUsers.length,
          };
        }

        return {
          tokensDeleted,
          rateLimitRowsDeleted,
          accountsDeleted: 0,
        };
      });
    },
  };
}
