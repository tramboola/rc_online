import { describe, expect, it } from "vitest";

import {
  ControlCommandSchema,
  RideGrantClaimsSchema,
  WebSocketEnvelopeSchema,
} from "./index.js";

describe("public contracts", () => {
  it("requires ride-control grants to carry all identity bindings", () => {
    const result = RideGrantClaimsSchema.safeParse({
      aud: "ride-control",
      jti: "a72d677b-df7a-4f24-9a80-e0b3735eb6e5",
      ride_id: "2c71c985-30e1-48c4-b5dc-b7a4f2a2da36",
      user_id: "cc977898-a9d1-418f-a487-b609a86c9b30",
      car_id: "0f3ac4fb-640a-42f0-9793-92a14a13a420",
      site_id: "21f4e6bb-4b39-4d28-a27e-efdeac906dbc",
      iat: 100,
      exp: 190,
    });
    expect(result.success).toBe(true);
  });

  it("bounds every actuator command", () => {
    const result = ControlCommandSchema.safeParse({
      version: 1,
      type: "control",
      rideIdTruncated: "0123456789abcdef",
      sequence: 12,
      monotonicMs: 1000,
      steering: 1001,
      throttle: 0,
      brake: 0,
      flags: 0,
    });
    expect(result.success).toBe(false);
  });

  it("requires stable websocket correlation metadata", () => {
    expect(
      WebSocketEnvelopeSchema.safeParse({
        v: 1,
        type: "ride.state.changed",
        payload: {},
      }).success,
    ).toBe(false);
  });
});
