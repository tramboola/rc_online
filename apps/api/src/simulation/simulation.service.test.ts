import { describe, expect, it } from "vitest";

import { SimulationService } from "./simulation.service.js";

describe("SimulationService", () => {
  it("runs the happy path through queue, offer, negotiation and completion", () => {
    const simulation = new SimulationService();
    expect(simulation.submitPreflight({ latencyMs: 68 }).ready).toBe(true);
    expect(simulation.joinQueue()).toMatchObject({ position: 1 });
    const offer = simulation.createOffer();
    const accepted = simulation.acceptOffer(offer.carIds[0]!);
    const active = simulation.startNegotiation(accepted.id);
    expect(active.state).toBe("ACTIVE");
    const completed = simulation.end(accepted.id);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.usedSeconds).toBe(120);
  });

  it("simulates five failed WebRTC attempts with full compensation", () => {
    const simulation = new SimulationService();
    simulation.setScenario("webrtc-five-failures");
    simulation.joinQueue();
    const offer = simulation.createOffer();
    const accepted = simulation.acceptOffer(offer.carIds[0]!);
    const failed = simulation.startNegotiation(accepted.id);
    expect(failed).toMatchObject({
      state: "FULLY_COMPENSATED",
      attemptCount: 5,
      usedSeconds: 0,
      remainingSeconds: 300,
    });
  });

  it("completes 100 accelerated virtual rides as a deterministic regression", () => {
    for (let index = 0; index < 100; index += 1) {
      const simulation = new SimulationService();
      simulation.joinQueue();
      const offer = simulation.createOffer();
      const ride = simulation.acceptOffer(offer.carIds[index % 2]!);
      expect(simulation.startNegotiation(ride.id).state).toBe("ACTIVE");
      expect(simulation.end(ride.id)).toMatchObject({
        state: "COMPLETED",
        usedSeconds: 120,
      });
    }
  });

  it("accepts every documented failure scenario", () => {
    const scenarios = [
      "normal",
      "webrtc-five-failures",
      "tab-reconnect",
      "pi-offline",
      "esp32-offline",
      "uart-corrupt",
      "battery-low",
      "battery-critical",
      "wan-failover",
      "redis-reset",
      "timing-offline",
      "camera-offline",
      "public-stream-offline",
      "disk-full",
      "power-loss",
    ] as const;
    const simulation = new SimulationService();
    for (const scenario of scenarios) {
      expect(simulation.setScenario(scenario)).toMatchObject({
        scenario,
        status: "applied",
      });
    }
  });
});
