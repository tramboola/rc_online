import { redirect } from "next/navigation";

import { auth } from "../../auth";
import { normalizeUserRole } from "../../auth/user-role";
import {
  loadOperationalStatus,
  type OperationalStatus,
} from "../operational-status";
import { getPostgresOperationalStatusStore } from "../postgres-operational-status-store";
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
  const adminAccess = role === "admin";
  let operationalStatus: OperationalStatus | undefined;
  if (
    mockMode &&
    adminAccess &&
    (resolvedScreen === "home" || resolvedScreen === "queue")
  ) {
    const databaseUrl = process.env.DATABASE_URL;
    operationalStatus = databaseUrl
      ? await loadOperationalStatus(getPostgresOperationalStatusStore(databaseUrl))
      : { state: "unavailable", cars: [], queueCount: null };
  }
  return (
    <SimulationScreen
      adminAccess={adminAccess}
      mockMode={mockMode}
      operationalStatus={operationalStatus}
      screen={resolvedScreen}
    />
  );
}
