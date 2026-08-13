import { cars, createDatabase, queueEntries } from "@rc/database";
import { and, count, eq, gt, inArray } from "drizzle-orm";

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
    async listAvailableCars() {
      return db.select({
        id: cars.id,
        slug: cars.slug,
        name: cars.name,
        batteryPercent: cars.batteryPercent,
      }).from(cars).where(and(
        eq(cars.state, "AVAILABLE"),
        eq(cars.adminBlocked, false),
      )).orderBy(cars.name);
    },

    async countActiveQueue(at) {
      const [row] = await db.select({ value: count() }).from(queueEntries)
        .where(and(
          inArray(queueEntries.status, ["waiting", "offered", "accepted"]),
          gt(queueEntries.expiresAt, at),
        ));
      return row?.value ?? 0;
    },
  };
  return operationalStore;
}
