import { redirect } from "next/navigation";

import { auth } from "../../auth";
import { normalizeUserRole } from "../../auth/user-role";
import {
  loadOperationalStatus,
  type OperationalStatus,
} from "../operational-status";
import { getPostgresOperationalStatusStore } from "../postgres-operational-status-store";
import { getPostgresLiveQueueStore, type LiveQueueSnapshot } from "../live-queue-store";
import { canAccessScreen } from "../screen-access";
import { SimulationScreen, type ScreenName } from "../simulation-screen";

const knownScreens = new Set<ScreenName>([
  "home",
  "how-it-works",
  "pricing",
  "leaderboard",
  "preflight",
  "queue",
  "loading",
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
  if (["preflight", "queue", "loading", "ride"].includes(resolvedScreen) && !session?.user.id) {
    redirect("/");
  }
  if (!canAccessScreen(resolvedScreen, mockMode, role)) {
    redirect("/");
  }
  const adminAccess = role === "admin";
  let operationalStatus: OperationalStatus | undefined;
  let liveQueueSnapshot: LiveQueueSnapshot | undefined;
  const databaseUrl = process.env.DATABASE_URL;
  if (
    mockMode &&
    adminAccess &&
    (resolvedScreen === "home" || resolvedScreen === "queue" || resolvedScreen === "loading")
  ) {
    operationalStatus = databaseUrl
      ? await loadOperationalStatus(getPostgresOperationalStatusStore(databaseUrl))
      : { state: "unavailable", cars: [], queueCount: null };
  }
  if (resolvedScreen === "queue" && databaseUrl && session?.user.id) {
    try {
      liveQueueSnapshot = await getPostgresLiveQueueStore(databaseUrl).join(
        session.user.id,
        new Date(),
      );
    } catch {
      liveQueueSnapshot = undefined;
    }
  }
  return (
    <SimulationScreen
      adminAccess={adminAccess}
      authenticated={Boolean(session?.user.email)}
      liveQueueSnapshot={liveQueueSnapshot}
      mockMode={mockMode}
      operationalStatus={operationalStatus}
      screen={resolvedScreen}
    />
  );
}
