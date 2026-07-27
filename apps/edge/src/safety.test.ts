import { describe, expect, it } from "vitest";

import { EdgeSafetyGate } from "./safety.js";

describe("EdgeSafetyGate", () => {
  it("rejects stale, replayed and cross-ride commands", () => {
    const safety = new EdgeSafetyGate();
    safety.activateRide("ride-a");
    expect(
      safety.apply(
        {
          rideId: "ride-b",
          sequence: 1,
          steering: 0,
          throttle: 500,
          brake: 0,
          receivedMonotonicMs: 1000,
        },
        1001,
      ),
    ).toMatchObject({ accepted: false, throttle: 0, reason: "ride_mismatch" });
    expect(
      safety.apply(
        {
          rideId: "ride-a",
          sequence: 1,
          steering: 0,
          throttle: 500,
          brake: 0,
          receivedMonotonicMs: 1000,
        },
        1201,
      ),
    ).toMatchObject({ accepted: false, reason: "stale_command" });
  });

  it("latches operator stop over all later user commands", () => {
    const safety = new EdgeSafetyGate();
    safety.activateRide("ride-a");
    safety.stop("track obstruction");
    expect(
      safety.apply(
        {
          rideId: "ride-a",
          sequence: 1,
          steering: 1000,
          throttle: 1000,
          brake: 0,
          receivedMonotonicMs: 1000,
        },
        1001,
      ),
    ).toMatchObject({
      accepted: false,
      steering: 0,
      throttle: 0,
      brake: 1000,
      reason: "operator_stop:latched",
    });
  });
});
