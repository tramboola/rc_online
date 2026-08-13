import { redirect } from "next/navigation";

import { auth } from "../../auth";
import { normalizeUserRole } from "../../auth/user-role";
import { canAccessScreen } from "../screen-access";
import { SimulationScreen, type ScreenName } from "../simulation-screen";

const knownScreens = new Set<ScreenName>([
  "home",
  "how-it-works",
  "pricing",
  "leaderboard",
  "preflight",
  "queue",
  "ride",
  "results",
  "operator",
]);

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ screen: string[] }>;
}) {
  const { screen } = await params;
  const requested = (screen[0] ?? "home") as ScreenName;
  const resolvedScreen = knownScreens.has(requested) ? requested : "home";
  const mockMode = process.env.MOCK_MODE === "true";
  const session = await auth();
  const role = normalizeUserRole(session?.user.role);
  if (!canAccessScreen(resolvedScreen, mockMode, role)) {
    redirect("/");
  }
  return (
    <SimulationScreen
      mockMode={mockMode}
      screen={resolvedScreen}
    />
  );
}
