import { SimulationScreen, type ScreenName } from "../simulation-screen";

const knownScreens = new Set<ScreenName>([
  "home",
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
  return (
    <SimulationScreen
      mockMode={process.env.MOCK_MODE === "true"}
      screen={knownScreens.has(requested) ? requested : "home"}
    />
  );
}
