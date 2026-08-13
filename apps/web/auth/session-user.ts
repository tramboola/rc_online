import type { AccountBalance, AuthStore } from "./auth-store";
import type { UserRole } from "./user-role";

export type SessionUserData = {
  id: string;
  role: UserRole;
  balance: AccountBalance;
};

export async function loadSessionUser(
  store: Pick<AuthStore, "getUser" | "getBalance">,
  userId: string,
): Promise<SessionUserData> {
  const [user, balance] = await Promise.all([
    store.getUser(userId),
    store.getBalance(userId),
  ]);
  if (!user || user.disabledAt) {
    throw new Error("Session user is unavailable");
  }
  return { id: user.id, role: user.role, balance };
}
