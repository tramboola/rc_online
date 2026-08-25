import type { DeviceHealth } from "@rc/contracts";

export function batteryCarUpdate(health: DeviceHealth): { batteryPercent?: number | null } {
  return health.batteryPercent === undefined ? {} : { batteryPercent: health.batteryPercent };
}
