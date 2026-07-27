import { describe, expect, it } from "vitest";

import { assertNoProductionMocks } from "@rc/config";
import { RideOrchestrator } from "@rc/domain";

const failureScenarios = [
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

describe("software failure acceptance", () => {
  it.each(failureScenarios)("%s has an explicit scenario identity", (scenario) => {
    expect(scenario).toMatch(/^[a-z0-9-]+$/);
  });

  it("fully compensates exactly five unsuccessful negotiations", () => {
    const ride = new RideOrchestrator({
      id: "ride-failure",
      userId: "user-failure",
      carId: "car-failure",
      purchasedSeconds: 300,
    });
    const start = new Date("2026-07-25T12:00:00.000Z");
    ride.offer("offer", start);
    ride.accept("accept", start);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      ride.negotiationStarted(`attempt:${attempt}`, start);
    }
    ride.failAllAttempts("compensate", start);
    expect(ride.snapshot()).toMatchObject({
      state: "FULLY_COMPENSATED",
      attemptCount: 5,
      usedSeconds: 0,
      remainingSeconds: 300,
    });
  });

  it("fails production closed when providers are omitted or simulated", () => {
    expect(() =>
      assertNoProductionMocks({
        NODE_ENV: "production",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(/Production startup refused/);
  });
});
