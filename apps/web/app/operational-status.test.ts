import { describe, expect, test } from "vitest";

import {
  loadOperationalStatus,
  type OperationalStatusStore,
} from "./operational-status";

const now = new Date("2026-08-13T12:00:00Z");

describe("loadOperationalStatus", () => {
  test("treats an empty production fleet as a valid zero-car state", async () => {
    const store: OperationalStatusStore = {
      async listAvailableCars(at) {
        expect(at).toEqual(now);
        return [];
      },
      async countActiveQueue(at) {
        expect(at).toEqual(now);
        return 0;
      },
    };

    await expect(loadOperationalStatus(store, now)).resolves.toEqual({
      state: "ready",
      cars: [],
      queueCount: 0,
    });
  });

  test("returns real available car fields without inventing presentation data", async () => {
    const store: OperationalStatusStore = {
      async listAvailableCars(at) {
        expect(at).toEqual(now);
        return [{
          id: "car-1",
          slug: "night-runner",
          name: "Night Runner",
          batteryPercent: 86,
        }];
      },
      async countActiveQueue() {
        return 2;
      },
    };

    await expect(loadOperationalStatus(store, now)).resolves.toEqual({
      state: "ready",
      cars: [{
        id: "car-1",
        slug: "night-runner",
        name: "Night Runner",
        batteryPercent: 86,
      }],
      queueCount: 2,
    });
  });

  test("reports unavailable operational data when PostgreSQL cannot be read", async () => {
    const store: OperationalStatusStore = {
      async listAvailableCars() {
        throw new Error("database offline");
      },
      async countActiveQueue() {
        return 0;
      },
    };

    await expect(loadOperationalStatus(store, now)).resolves.toEqual({
      state: "unavailable",
      cars: [],
      queueCount: null,
    });
  });
});
