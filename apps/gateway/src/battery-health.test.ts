import { describe, expect, it } from "vitest";

import type { DeviceHealth } from "@rc/contracts";

import { batteryCarUpdate } from "./battery-health.js";

const baseHealth: DeviceHealth = {
  cameraReady: true,
  gpioReady: true,
  watchdogReady: true,
  width: 1280,
  height: 720,
  fps: 60,
  cpuTemperatureC: 48.5,
  wifiSignalDbm: -51
};

describe("batteryCarUpdate", () => {
  it("leaves the stored car battery unchanged when a legacy heartbeat omits it", () => {
    expect(batteryCarUpdate(baseHealth)).toEqual({});
  });

  it("clears the stored car battery when the device reports it unavailable", () => {
    expect(batteryCarUpdate({ ...baseHealth, batteryPercent: null })).toEqual({ batteryPercent: null });
  });

  it("persists a numeric device battery percentage", () => {
    expect(batteryCarUpdate({ ...baseHealth, batteryPercent: 94 })).toEqual({ batteryPercent: 94 });
  });
});
