import { SimulationScreen } from "./simulation-screen";

export default function HomePage() {
  return (
    <SimulationScreen
      mockMode={process.env.MOCK_MODE === "true"}
      screen="home"
    />
  );
}
