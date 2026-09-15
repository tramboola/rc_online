import { describe, expect, it, vi } from "vitest";

import { createPostgresLiveQueueStore, queueSnapshotFromState } from "./live-queue-store";

const database = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@rc/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@rc/database")>(),
  createDatabase: () => ({ db: database }),
}));

const car = {
  id: "d17e00d9-436f-4387-b8b4-27f941bab3cc",
  slug: "rc-mania-one",
  name: "RC Mania One",
  batteryPercent: 74,
  availability: "available" as const,
};

describe("active driver's live queue", () => {
  it.each(["join", "read"] as const)("%s retains the fleet without offering a second session", async (method) => {
    const occupied = { ...car, id: "second-car", slug: "rcmania-zero2w-02", name: "RCmania Two", availability: "in_use" as const };
    const entries = [{ id: "waiting-entry", userId: "another-user" }];
    const tx = {
      update: vi.fn(() => ({ set: () => ({ where: async () => [] }) })),
      select: vi.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ queueEntryId: "accepted-entry" }] }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => entries }) }) }),
      selectDistinct: vi.fn(() => ({ from: () => ({ innerJoin: () => ({ leftJoin: () => ({ where: () => ({
        orderBy: async () => [car, occupied].map(({ availability, ...row }) => ({
          ...row,
          carState: availability === "available" ? "AVAILABLE" : "ACTIVE",
          driveSessionId: availability === "available" ? null : "active-session",
        })),
      }) }) }) }) })),
      insert: vi.fn(),
    };
    database.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));

    const snapshot = await createPostgresLiveQueueStore("postgres://test")[method]("driving-user", new Date("2026-09-14T18:35:50Z"));

    expect(snapshot).toEqual({
      entryId: "accepted-entry",
      position: 0,
      count: 1,
      availableCarCount: 1,
      status: "driving",
      cars: [car, occupied],
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe("queueSnapshotFromState", () => {
  it("shows the fleet but offers an available car only to the first waiting user", () => {
    const entries = [
      { id: "first", userId: "user-a" },
      { id: "second", userId: "user-b" },
    ];

    expect(queueSnapshotFromState("user-a", entries, [car])).toMatchObject({
      entryId: "first",
      position: 1,
      count: 2,
      availableCarCount: 1,
      status: "ready",
      cars: [car],
    });
    expect(queueSnapshotFromState("user-b", entries, [car])).toMatchObject({
      entryId: "second",
      position: 2,
      count: 2,
      availableCarCount: 1,
      status: "waiting",
      cars: [car],
    });
  });

  it("lets the first N users choose a car when N cars are available", () => {
    const secondCar = { ...car, id: "c61e049a-8b8f-407c-9826-64ea6f48ad06", slug: "two" };
    const entries = [
      { id: "first", userId: "user-a" },
      { id: "second", userId: "user-b" },
      { id: "third", userId: "user-c" },
    ];

    expect(queueSnapshotFromState("user-b", entries, [car, secondCar]).status).toBe("ready");
    expect(queueSnapshotFromState("user-c", entries, [car, secondCar]).status).toBe("waiting");
  });

  it("keeps occupied cars visible without counting them as available", () => {
    const occupiedCar = {
      ...car,
      id: "98d789d2-c0a8-44ef-98fd-d51564e4909e",
      slug: "occupied",
      availability: "in_use" as const,
    };
    const entries = [
      { id: "first", userId: "user-a" },
      { id: "second", userId: "user-b" },
    ];

    expect(queueSnapshotFromState("user-a", entries, [car, occupiedCar])).toMatchObject({
      availableCarCount: 1,
      status: "ready",
      cars: [car, occupiedCar],
    });
    expect(queueSnapshotFromState("user-b", entries, [car, occupiedCar])).toMatchObject({
      availableCarCount: 1,
      status: "waiting",
      cars: [car, occupiedCar],
    });
  });
});
