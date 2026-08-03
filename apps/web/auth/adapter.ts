import type {
  Adapter,
  AdapterSession,
  AdapterUser,
} from "next-auth/adapters";

import type { AuthStore, StoredAuthSession, StoredAuthUser } from "./auth-store";
import { hashSessionToken } from "./session-token";

function toAdapterUser(user: StoredAuthUser | null): AdapterUser | null {
  if (!user || user.disabledAt) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt,
    name: user.displayName,
    image: null,
  };
}

function toAdapterSession(session: StoredAuthSession, rawToken: string): AdapterSession {
  return {
    sessionToken: rawToken,
    userId: session.userId,
    expires: session.expiresAt,
  };
}

export function createRcAuthAdapter(
  store: AuthStore,
  now: () => Date = () => new Date(),
): Adapter {
  return {
    async createUser(user) {
      const created = await store.createUser({
        id: user.id,
        email: user.email.trim().toLowerCase(),
        displayName: user.name?.trim() || user.email,
        emailVerifiedAt: user.emailVerified,
        disabledAt: null,
      });
      return toAdapterUser(created)!;
    },

    async getUser(id) {
      return toAdapterUser(await store.getUser(id));
    },

    async getUserByEmail(email) {
      return toAdapterUser(await store.getUserByEmail(email.trim().toLowerCase()));
    },

    async getUserByAccount({ provider, providerAccountId }) {
      return toAdapterUser(await store.getUserByIdentity(provider, providerAccountId));
    },

    async updateUser(update) {
      const current = await store.getUser(update.id);
      if (!current || current.disabledAt) {
        throw new Error("User is unavailable");
      }
      const saved = await store.updateUser({
        ...current,
        email: update.email?.trim().toLowerCase() ?? current.email,
        displayName: update.name?.trim() || current.displayName,
        emailVerifiedAt: update.emailVerified ?? current.emailVerifiedAt,
      });
      return toAdapterUser(saved)!;
    },

    async linkAccount(account) {
      await store.linkIdentity(account.userId, account.provider, account.providerAccountId);
      return account;
    },

    async createSession(session) {
      const stored = await store.createSession({
        userId: session.userId,
        tokenHash: hashSessionToken(session.sessionToken),
        expiresAt: session.expires,
        lastSeenAt: now(),
      });
      return toAdapterSession(stored, session.sessionToken);
    },

    async getSessionAndUser(sessionToken) {
      const tokenHash = hashSessionToken(sessionToken);
      const session = await store.getSession(tokenHash);
      if (!session) {
        return null;
      }
      if (session.expiresAt.getTime() <= now().getTime()) {
        await store.deleteSession(tokenHash);
        return null;
      }
      const user = toAdapterUser(await store.getUser(session.userId));
      if (!user) {
        await store.deleteSession(tokenHash);
        return null;
      }
      return { session: toAdapterSession(session, sessionToken), user };
    },

    async updateSession(update) {
      const tokenHash = hashSessionToken(update.sessionToken);
      const current = await store.getSession(tokenHash);
      if (!current) {
        return null;
      }
      const saved = await store.updateSession({
        ...current,
        userId: update.userId ?? current.userId,
        expiresAt: update.expires ?? current.expiresAt,
        lastSeenAt: now(),
      });
      return toAdapterSession(saved, update.sessionToken);
    },

    async deleteSession(sessionToken) {
      const deleted = await store.deleteSession(hashSessionToken(sessionToken));
      return deleted ? toAdapterSession(deleted, sessionToken) : null;
    },
  };
}
