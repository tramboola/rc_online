import type { RideSnapshot } from "@rc/contracts";

export * from "./ledger.js";
export * from "./queue.js";
export * from "./rides.js";
export * from "./state-machine.js";

export function assertRideSnapshot(snapshot: RideSnapshot): RideSnapshot {
  if (snapshot.usedSeconds + snapshot.remainingSeconds > snapshot.purchasedSeconds) {
    throw new Error("Ride time invariant violated");
  }
  return snapshot;
}
