import { auth } from "../auth";
import {
  loadOperationalStatus,
  type OperationalStatus,
} from "./operational-status";
import { getPostgresOperationalStatusStore } from "./postgres-operational-status-store";
import { SimulationScreen } from "./simulation-screen";

export default async function HomePage() {
  const mockMode = process.env.MOCK_MODE === "true";
  const session = await auth();
  const adminAccess = session?.user.role === "admin";
  let operationalStatus: OperationalStatus | undefined;
  if (mockMode && adminAccess) {
    const databaseUrl = process.env.DATABASE_URL;
    operationalStatus = databaseUrl
      ? await loadOperationalStatus(getPostgresOperationalStatusStore(databaseUrl))
      : { state: "unavailable", cars: [], queueCount: null };
  }

  return (
    <SimulationScreen
      adminAccess={adminAccess}
      authenticated={Boolean(session?.user.email)}
      mockMode={mockMode}
      operationalStatus={operationalStatus}
      screen="home"
    />
  );
}
