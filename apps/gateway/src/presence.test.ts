import { describe, expect, it } from "vitest";

import type { DeviceHealth } from "@rc/contracts";

import { PresenceRegistry } from "./presence.js";
import type { GatewayStore, PresenceState } from "./store.js";

const healthy: DeviceHealth = {
  cameraReady: true,
  gpioReady: true,
  watchdogReady: true,
  width: 1280,
  height: 720,
  fps: 60,
  cpuTemperatureC: 48.5,
  wifiSignalDbm: -51
};

function fakeStore(adminBlocked = false) {
  const states: PresenceState[] = [];
  const store = {
    recordHeartbeat: async () => ({ carId: "car-1", adminBlocked }),
    setPresenceState: async (_deviceId: string, state: PresenceState) => {
      states.push(state);
    },
    markDeviceOffline: async () => {
      states.push("OFFLINE");
    },
    expireStaleDevices: async () => 0
  } as unknown as GatewayStore;

  return { store, states };
}

describe("PresenceRegistry", () => {
  it("publishes AVAILABLE only when every safety health signal is ready", async () => {
    const { store, states } = fakeStore();
    const registry = new PresenceRegistry(store);

    await registry.heartbeat("device-1", healthy, new Date("2026-08-13T10:00:00Z"));

    expect(states).toEqual(["AVAILABLE"]);
  });

  it.each([
    ["camera", { cameraReady: false }],
    ["GPIO", { gpioReady: false }],
    ["watchdog", { watchdogReady: false }]
  ])("fails closed when %s health fails", async (_name, failed) => {
    const { store, states } = fakeStore();
    const registry = new PresenceRegistry(store);

    await registry.heartbeat("device-1", { ...healthy, ...failed }, new Date());

    expect(states).toEqual(["SAFETY_BLOCKED"]);
  });

  it("never lets a healthy heartbeat clear an administrative block", async () => {
    const { store, states } = fakeStore(true);
    const registry = new PresenceRegistry(store);

    await registry.heartbeat("device-1", healthy, new Date());

    expect(states).toEqual(["ADMIN_BLOCKED"]);
  });

  it("moves the car offline on disconnect and after the 15 second freshness window", async () => {
    const { store, states } = fakeStore();
    const registry = new PresenceRegistry(store, 15_000);
    const startedAt = new Date("2026-08-13T10:00:00Z");
    await registry.heartbeat("device-1", healthy, startedAt);

    await registry.sweep(new Date("2026-08-13T10:00:15.001Z"));
    await registry.disconnect("device-2", new Date());

    expect(states).toEqual(["AVAILABLE", "OFFLINE", "OFFLINE"]);
  });
});
