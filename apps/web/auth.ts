import NextAuth, { type NextAuthResult } from "next-auth";
import Google, { type GoogleProfile } from "next-auth/providers/google";

import { createRcAuthAdapter } from "./auth/adapter";
import {
  readAuthRuntimeEnvironment,
  sanitizeReturnPath,
} from "./auth/config";
import type { AuthStore } from "./auth/auth-store";
import { createPostgresAuthStore } from "./auth/postgres-auth-store";

let authStore: AuthStore | undefined;
let authStoreUrl: string | undefined;

function getAuthStore(databaseUrl: string): AuthStore {
  if (!authStore || authStoreUrl !== databaseUrl) {
    authStore = createPostgresAuthStore(databaseUrl);
    authStoreUrl = databaseUrl;
  }
  return authStore;
}

const nextAuth: NextAuthResult = NextAuth(() => {
  const environment = readAuthRuntimeEnvironment(process.env);
  const store = getAuthStore(environment.databaseUrl);

  return {
    adapter: createRcAuthAdapter(store),
    secret: environment.authSecret,
    trustHost: true,
    session: {
      strategy: "database",
      maxAge: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    pages: {
      error: "/auth/error",
    },
    providers: [
      Google({
        clientId: environment.googleClientId,
        clientSecret: environment.googleClientSecret,
        allowDangerousEmailAccountLinking: true,
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "google") {
          return false;
        }
        const googleProfile = profile as GoogleProfile | undefined;
        return Boolean(googleProfile?.email && googleProfile.email_verified);
      },
      async session({ session, user }) {
        const balance = await store.getBalance(user.id);
        session.user.id = user.id;
        session.user.balance = balance;
        return session;
      },
      async redirect({ url }) {
        const canonicalOrigin = environment.authUrl;
        if (url.startsWith("/")) {
          return new URL(sanitizeReturnPath(url), canonicalOrigin).toString();
        }
        try {
          const parsed = new URL(url);
          if (parsed.origin === canonicalOrigin) {
            return new URL(
              sanitizeReturnPath(`${parsed.pathname}${parsed.search}${parsed.hash}`),
              canonicalOrigin,
            ).toString();
          }
        } catch {
          // Auth.js receives untrusted return URLs; invalid values fall back home.
        }
        return `${canonicalOrigin}/`;
      },
    },
  };
});

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
