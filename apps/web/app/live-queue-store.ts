import { cars, createDatabase, devices, driveSessions, queueEntries } from "@rc/database";
import { and, asc, eq, gt, inArray, lte, notExists } from "drizzle-orm";

import type { AvailableCar } from "./operational-status";

export type LiveQueueSnapshot = {
  entryId: string;
  position: number;
  count: number;
  availableCarCount: number;
  status: "waiting" | "ready" | "driving";
  cars: AvailableCar[];
};

export interface LiveQueueStore {
  join(userId: string, now: Date): Promise<LiveQueueSnapshot>;
  read(userId: string, now: Date): Promise<LiveQueueSnapshot>;
  leave(userId: string, now: Date): Promise<void>;
}

let postgresLiveQueueStore: LiveQueueStore | undefined;
let postgresLiveQueueStoreUrl: string | undefined;

export function getPostgresLiveQueueStore(databaseUrl: string): LiveQueueStore {
  if (!postgresLiveQueueStore || postgresLiveQueueStoreUrl !== databaseUrl) {
    postgresLiveQueueStore = createPostgresLiveQueueStore(databaseUrl);
    postgresLiveQueueStoreUrl = databaseUrl;
  }
  return postgresLiveQueueStore;
}

type QueuePositionRow = { id: string; userId: string };

const LIVE_QUEUE_STATUSES = ["waiting", "offered"] as const;
const ACTIVE_DRIVE_SESSION_STATUSES = ["created", "negotiating", "active"] as const;
const QUEUE_LEASE_MS = 60_000;
const DEVICE_FRESHNESS_MS = 15_000;

export function queueSnapshotFromState(
  userId: string,
  entries: QueuePositionRow[],
  availableCars: AvailableCar[],
): LiveQueueSnapshot {
  const index = entries.findIndex((entry) => entry.userId === userId);
  if (index < 0) throw new Error("Live queue entry is missing");
  const position = index + 1;
  const ready = availableCars.length > 0 && position <= availableCars.length;
  return {
    entryId: entries[index]!.id,
    position,
    count: entries.length,
    availableCarCount: availableCars.length,
    status: ready ? "ready" : "waiting",
    cars: ready ? availableCars : [],
  };
}

export function createPostgresLiveQueueStore(databaseUrl: string): LiveQueueStore {
  const { db } = createDatabase(databaseUrl);

  async function joinOrRefresh(userId: string, now: Date): Promise<LiveQueueSnapshot> {
    return db.transaction(async (tx) => {
      await tx.update(queueEntries)
        .set({ status: "expired", updatedAt: now })
        .where(and(
          inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]),
          lte(queueEntries.expiresAt, now),
        ));

      const [driving] = await tx.select({
        queueEntryId: driveSessions.queueEntryId,
      }).from(driveSessions).where(and(
        eq(driveSessions.userId, userId),
        inArray(driveSessions.status, [...ACTIVE_DRIVE_SESSION_STATUSES]),
        gt(driveSessions.expiresAt, now),
      )).limit(1);
      if (driving?.queueEntryId) {
        const activeEntries = await listActiveEntries(tx, now);
        return {
          entryId: driving.queueEntryId,
          position: 0,
          count: activeEntries.length,
          availableCarCount: 0,
          status: "driving",
          cars: [],
        };
      }

      const leaseExpiresAt = new Date(now.getTime() + QUEUE_LEASE_MS);
      await tx.insert(queueEntries).values({
        userId,
        status: "waiting",
        joinedAt: now,
        expiresAt: leaseExpiresAt,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();

      const [entry] = await tx.select({ id: queueEntries.id })
        .from(queueEntries)
        .where(and(
          eq(queueEntries.userId, userId),
          inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]),
          gt(queueEntries.expiresAt, now),
        ))
        .orderBy(asc(queueEntries.joinedAt), asc(queueEntries.id))
        .limit(1);
      if (!entry) throw new Error("Could not join live queue");

      await tx.update(queueEntries)
        .set({ expiresAt: leaseExpiresAt, updatedAt: now })
        .where(eq(queueEntries.id, entry.id));

      const entries = await listActiveEntries(tx, now);
      const availableCars = await listAvailableCars(tx, now);
      return queueSnapshotFromState(userId, entries, availableCars);
    });
  }

  return {
    join: joinOrRefresh,
    read: joinOrRefresh,
    async leave(userId, now) {
      await db.update(queueEntries)
        .set({ status: "left", updatedAt: now, expiresAt: now })
        .where(and(
          eq(queueEntries.userId, userId),
          inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]),
        ));
    },
  };
}

type QueueTransaction = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];

async function listActiveEntries(tx: QueueTransaction, now: Date): Promise<QueuePositionRow[]> {
  return tx.select({ id: queueEntries.id, userId: queueEntries.userId })
    .from(queueEntries)
    .where(and(
      inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]),
      gt(queueEntries.expiresAt, now),
    ))
    .orderBy(asc(queueEntries.joinedAt), asc(queueEntries.id));
}

async function listAvailableCars(tx: QueueTransaction, now: Date): Promise<AvailableCar[]> {
  const freshnessCutoff = new Date(now.getTime() - DEVICE_FRESHNESS_MS);
  return tx.selectDistinct({
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
        tx.select({ id: driveSessions.id }).from(driveSessions).where(and(
          eq(driveSessions.carId, cars.id),
          inArray(driveSessions.status, [...ACTIVE_DRIVE_SESSION_STATUSES]),
          gt(driveSessions.expiresAt, now),
        )),
      ),
    ))
    .orderBy(asc(cars.name), asc(cars.id));
}
