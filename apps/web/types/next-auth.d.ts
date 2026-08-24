import type { DefaultSession } from "next-auth";
import type { UserRole } from "../auth/user-role";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      balance: {
        currency: "USD";
        amountMinor: number;
      };
      nickname: string;
      avatarKey: string;
    };
  }
}
