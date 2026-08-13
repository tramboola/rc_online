import type { UserRole } from "../auth/user-role";
import type { ScreenName } from "./simulation-screen";

const restrictedMockScreens = new Set<ScreenName>([
  "preflight",
  "queue",
  "ride",
  "results",
  "operator",
]);

export function canAccessScreen(
  screen: ScreenName,
  mockMode: boolean,
  role: UserRole,
): boolean {
  return !mockMode || !restrictedMockScreens.has(screen) || role === "admin";
}
