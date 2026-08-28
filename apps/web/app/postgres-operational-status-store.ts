import { cars, createDatabase, devices, driveSessions, queueEntries } from "@rc/database";
import { and, count, eq, gt, inArray, notExists } from "drizzle-orm";

import type { OperationalStatusStore } from "./operational-status";

let operationalStore: OperationalStatusStore | undefined;
let operationalStoreUrl: string | undefined;

export function getPostgresOperationalStatusStore(
  databaseUrl: string,
): OperationalStatusStore {
  if (operationalStore && operationalStoreUrl === databaseUrl) {
    return operationalStore;
  }

  const { db } = createDatabase(databaseUrl);
  operationalStoreUrl = databaseUrl;
  operationalStore = {
    async listAvailableCars(at) {
      const freshnessCutoff = new Date(at.getTime() - 15_000);
      return db.selectDistinct({
        id: cars.id,
        slug: cars.slug,
        name: cars.name,
        batteryPercent: cars.batteryPercent,
      }).from(cars)
        .innerJoin(devices, eq(devices.carId, cars.id))
        .where(and(
        eq(cars.state, "AVAILABLE"),
        eq(cars.adminBlocked, false),
        eq(devices.state, "AVAILABLE"),
        gt(devices.lastSeenAt, freshnessCutoff),
        notExists(
          db.select({ id: driveSessions.id }).from(driveSessions).where(and(
            eq(driveSessions.carId, cars.id),
            inArray(driveSessions.status, ["created", "negotiating", "active"]),
            gt(driveSessions.expiresAt, at),
          )),
        ),
      )).orderBy(cars.name);
    },

    async countActiveQueue(at) {
      const [row] = await db.select({ value: count() }).from(queueEntries)
        .where(and(
          inArray(queueEntries.status, ["waiting", "offered"]),
          gt(queueEntries.expiresAt, at),
        ));
      return row?.value ?? 0;
    },
  };
  return operationalStore;
}
