import { describe, expect, it } from "vitest";

import { queueSnapshotFromState } from "./live-queue-store";

const car = {
  id: "d17e00d9-436f-4387-b8b4-27f941bab3cc",
  slug: "rc-mania-one",
  name: "RC Mania One",
  batteryPercent: 74,
  availability: "available" as const,
};

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
