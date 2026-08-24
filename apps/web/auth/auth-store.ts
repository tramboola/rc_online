import type { UserRole } from "./user-role";
import type { SessionProfile } from "./account-profile";

export type StoredAuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
};

export type StoredAuthSession = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
};

export type AccountBalance = {
  currency: "USD";
  amountMinor: number;
};

export interface AuthStore {
  createUser(user: StoredAuthUser): Promise<StoredAuthUser>;
  getUser(id: string): Promise<StoredAuthUser | null>;
  getUserByEmail(email: string): Promise<StoredAuthUser | null>;
  getUserByIdentity(provider: string, subject: string): Promise<StoredAuthUser | null>;
  updateUser(user: StoredAuthUser): Promise<StoredAuthUser>;
  linkIdentity(userId: string, provider: string, subject: string): Promise<void>;
  createSession(session: StoredAuthSession): Promise<StoredAuthSession>;
  getSession(tokenHash: string): Promise<StoredAuthSession | null>;
  updateSession(session: StoredAuthSession): Promise<StoredAuthSession>;
  deleteSession(tokenHash: string): Promise<StoredAuthSession | null>;
  getBalance(userId: string): Promise<AccountBalance>;
  getSessionProfile(userId: string): Promise<SessionProfile>;
}
