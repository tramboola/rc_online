import { describe, expect, it } from "vitest";

import { mapThrottlePosition, mapTiltToSteering, smoothAxis, throttleAxisToTrackPercent } from "./mobile-control";

describe("mobile proportional controls", () => {
  it("maps landscape tilt around the captured center with deadzone and clamps endpoints", () => {
    expect(mapTiltToSteering(10, 10)).toBe(0);
    expect(mapTiltToSteering(12, 10)).toBe(0);
    expect(mapTiltToSteering(22, 10)).toBeCloseTo(0.409, 3);
    expect(mapTiltToSteering(-20, 10)).toBe(-1);
    expect(mapTiltToSteering(50, 10)).toBe(1);
  });

  it("smooths transient sensor changes without overshooting", () => {
    expect(smoothAxis(0, 1)).toBeCloseTo(0.24, 5);
    expect(smoothAxis(0.9, -1)).toBeCloseTo(0.444, 5);
  });

  it("uses three quarters of the throttle track for forward and one quarter for reverse", () => {
    expect(mapThrottlePosition(0, 400)).toBe(1);
    expect(mapThrottlePosition(150, 400)).toBe(0.5);
    expect(mapThrottlePosition(300, 400)).toBe(0);
    expect(mapThrottlePosition(350, 400)).toBe(-0.5);
    expect(mapThrottlePosition(400, 400)).toBe(-1);
    expect(throttleAxisToTrackPercent(1)).toBe(0);
    expect(throttleAxisToTrackPercent(0)).toBe(75);
    expect(throttleAxisToTrackPercent(-1)).toBe(100);
  });
});
