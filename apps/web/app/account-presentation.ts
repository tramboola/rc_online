import type { Session } from "next-auth";

import { isAvatarKey, type AvatarKey } from "../auth/avatar";
import type { UserRole } from "../auth/user-role";

export type AccountPresentation =
  | {
      state: "signed-out";
      primary: "SIGN IN";
      secondary: "ACCOUNT";
    }
  | {
      state: "signed-in";
      primary: string;
      secondary: "BALANCE";
      displayName: string;
      email: string;
      avatarKey: AvatarKey;
      avatarSrc: string;
      role: UserRole;
    };

export function getAccountPresentation(session: Session | null): AccountPresentation {
  if (!session?.user?.email) {
    return {
      state: "signed-out",
      primary: "SIGN IN",
      secondary: "ACCOUNT",
    };
  }

  const avatarKey = isAvatarKey(session.user.avatarKey) ? session.user.avatarKey : "racer-red";
  return {
    state: "signed-in",
    primary: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session.user.balance.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(session.user.balance.amountMinor / 100),
    secondary: "BALANCE",
    displayName: session.user.nickname.trim() || "RC DRIVER",
    email: session.user.email,
    avatarKey,
    avatarSrc: `/assets/avatars/${avatarKey}.webp`,
    role: session.user.role,
  };
}
