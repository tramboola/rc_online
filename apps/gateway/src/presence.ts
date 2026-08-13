import type { DeviceHealth } from "@rc/contracts";

import type { GatewayStore, PresenceState } from "./store.js";

export class PresenceRegistry {
  readonly #store: GatewayStore;
  readonly #staleAfterMs: number;
  readonly #lastSeen = new Map<string, number>();

  constructor(store: GatewayStore, staleAfterMs = 15_000) {
    this.#store = store;
    this.#staleAfterMs = staleAfterMs;
  }

  async heartbeat(deviceId: string, health: DeviceHealth, now = new Date()): Promise<void> {
    const device = await this.#store.recordHeartbeat(deviceId, health, now);
    if (!device) throw new Error("Device is no longer active");

    this.#lastSeen.set(deviceId, now.getTime());
    await this.#store.setPresenceState(deviceId, chooseState(device.adminBlocked, health), now);
  }

  async disconnect(deviceId: string, now = new Date()): Promise<void> {
    this.#lastSeen.delete(deviceId);
    await this.#store.markDeviceOffline(deviceId, now);
  }

  async sweep(now = new Date()): Promise<void> {
    const cutoffMs = now.getTime() - this.#staleAfterMs;
    for (const [deviceId, seenAt] of this.#lastSeen) {
      if (seenAt < cutoffMs) {
        this.#lastSeen.delete(deviceId);
        await this.#store.markDeviceOffline(deviceId, now);
      }
    }
    await this.#store.expireStaleDevices(new Date(cutoffMs), now);
  }
}

function chooseState(adminBlocked: boolean, health: DeviceHealth): PresenceState {
  if (adminBlocked) return "ADMIN_BLOCKED";
  if (!health.cameraReady || !health.gpioReady || !health.watchdogReady) {
    return "SAFETY_BLOCKED";
  }
  return "AVAILABLE";
}
