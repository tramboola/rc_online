import type { AccountBalance, AuthStore } from "./auth-store";
import type { SessionProfile } from "./account-profile";
import type { UserRole } from "./user-role";

export type SessionUserData = {
  id: string;
  role: UserRole;
  balance: AccountBalance;
  nickname: SessionProfile["nickname"];
  avatarKey: SessionProfile["avatarKey"];
};

export async function loadSessionUser(
  store: Pick<AuthStore, "getUser" | "getBalance" | "getSessionProfile">,
  userId: string,
): Promise<SessionUserData> {
  const user = await store.getUser(userId);
  if (!user || user.disabledAt) {
    throw new Error("Session user is unavailable");
  }
  const [balance, profile] = await Promise.all([
    store.getBalance(user.id),
    store.getSessionProfile(user.id),
  ]);
  return {
    id: user.id,
    role: user.role,
    balance,
    nickname: profile.nickname,
    avatarKey: profile.avatarKey,
  };
}
