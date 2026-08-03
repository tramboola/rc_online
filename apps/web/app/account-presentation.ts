import type { Session } from "next-auth";

export type AccountPresentation =
  | {
      state: "signed-out";
      primary: "SIGN IN";
      secondary: "WITH GOOGLE";
    }
  | {
      state: "signed-in";
      primary: string;
      secondary: "BALANCE";
      displayName: string;
      email: string;
      initials: string;
    };

function getInitials(displayName: string, email: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return (words[0]?.[0] ?? email[0] ?? "U").toUpperCase();
}

export function getAccountPresentation(session: Session | null): AccountPresentation {
  if (!session?.user?.email) {
    return {
      state: "signed-out",
      primary: "SIGN IN",
      secondary: "WITH GOOGLE",
    };
  }

  const displayName = session.user.name?.trim() || session.user.email;
  return {
    state: "signed-in",
    primary: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session.user.balance.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(session.user.balance.amountMinor / 100),
    secondary: "BALANCE",
    displayName,
    email: session.user.email,
    initials: getInitials(displayName, session.user.email),
  };
}
