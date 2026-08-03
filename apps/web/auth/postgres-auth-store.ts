import {
  accountBalances,
  authSessions,
  createDatabase,
  oauthIdentities,
  users,
} from "@rc/database";
import { and, eq } from "drizzle-orm";

import type {
  AccountBalance,
  AuthStore,
  StoredAuthSession,
  StoredAuthUser,
} from "./auth-store";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof authSessions.$inferSelect;

function mapUser(row: UserRow): StoredAuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerifiedAt: row.emailVerifiedAt,
    disabledAt: row.disabledAt,
  };
}

function mapSession(row: SessionRow): StoredAuthSession {
  return {
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function createPostgresAuthStore(databaseUrl: string): AuthStore {
  const { db } = createDatabase(databaseUrl);

  return {
    async createUser(user) {
      return db.transaction(async (transaction) => {
        const [created] = await transaction.insert(users).values({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          emailVerifiedAt: user.emailVerifiedAt,
          disabledAt: user.disabledAt,
        }).returning();
        if (!created) {
          throw new Error("User creation returned no row");
        }
        await transaction.insert(accountBalances).values({
          userId: created.id,
          currency: "USD",
          amountMinor: 0,
        });
        return mapUser(created);
      });
    },

    async getUser(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? mapUser(row) : null;
    },

    async getUserByEmail(email) {
      const [row] = await db.select().from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      return row ? mapUser(row) : null;
    },

    async getUserByIdentity(provider, subject) {
      const [row] = await db.select({ user: users }).from(oauthIdentities)
        .innerJoin(users, eq(oauthIdentities.userId, users.id))
        .where(and(
          eq(oauthIdentities.provider, provider),
          eq(oauthIdentities.providerSubject, subject),
        ))
        .limit(1);
      return row ? mapUser(row.user) : null;
    },

    async updateUser(user) {
      const [updated] = await db.update(users).set({
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt,
        disabledAt: user.disabledAt,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id)).returning();
      if (!updated) {
        throw new Error("User does not exist");
      }
      return mapUser(updated);
    },

    async linkIdentity(userId, provider, subject) {
      await db.transaction(async (transaction) => {
        const [subjectIdentity] = await transaction.select().from(oauthIdentities)
          .where(and(
            eq(oauthIdentities.provider, provider),
            eq(oauthIdentities.providerSubject, subject),
          ))
          .limit(1);
        if (subjectIdentity) {
          if (subjectIdentity.userId !== userId) {
            throw new Error("OAuth identity belongs to another user");
          }
          return;
        }

        const [userIdentity] = await transaction.select().from(oauthIdentities)
          .where(and(
            eq(oauthIdentities.userId, userId),
            eq(oauthIdentities.provider, provider),
          ))
          .limit(1);
        if (userIdentity && userIdentity.providerSubject !== subject) {
          throw new Error("User already has a different OAuth identity");
        }

        await transaction.insert(oauthIdentities).values({
          userId,
          provider,
          providerSubject: subject,
        });
      });
    },

    async createSession(session) {
      const [created] = await db.insert(authSessions).values({
        userId: session.userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
      }).returning();
      if (!created) {
        throw new Error("Session creation returned no row");
      }
      return mapSession(created);
    },

    async getSession(tokenHash) {
      const [row] = await db.select().from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1);
      return row ? mapSession(row) : null;
    },

    async updateSession(session) {
      const [updated] = await db.update(authSessions).set({
        userId: session.userId,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        updatedAt: new Date(),
      }).where(eq(authSessions.tokenHash, session.tokenHash)).returning();
      if (!updated) {
        throw new Error("Session does not exist");
      }
      return mapSession(updated);
    },

    async deleteSession(tokenHash) {
      const [deleted] = await db.delete(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .returning();
      return deleted ? mapSession(deleted) : null;
    },

    async getBalance(userId): Promise<AccountBalance> {
      await db.insert(accountBalances).values({
        userId,
        currency: "USD",
        amountMinor: 0,
      }).onConflictDoNothing({ target: accountBalances.userId });
      const [row] = await db.select().from(accountBalances)
        .where(eq(accountBalances.userId, userId))
        .limit(1);
      if (!row || row.currency !== "USD") {
        throw new Error("USD account balance is unavailable");
      }
      return { currency: "USD", amountMinor: row.amountMinor };
    },
  };
}
