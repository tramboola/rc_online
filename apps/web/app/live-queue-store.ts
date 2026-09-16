import { cars, createDatabase, devices, driveSessions, queueEntries } from "@rc/database";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import type { AvailableCar } from "./operational-status";

export type LiveQueueSnapshot = {
  entryId: string;
  position: number;
  count: number;
  availableCarCount: number;
  status: "waiting" | "ready" | "driving" | "expired";
  offerExpiresAt?: string | null;
  serverNow?: string;
  cars: QueueCar[];
};

export type QueueCar = AvailableCar & {
  availability: "available" | "in_use";
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

type QueuePositionRow = { id: string; userId: string; status?: string; expiresAt?: Date };

const LIVE_QUEUE_STATUSES = ["waiting", "offered"] as const;
const ACTIVE_DRIVE_SESSION_STATUSES = ["created", "negotiating", "active"] as const;
const QUEUE_LEASE_MS = 60_000;
export const QUEUE_OFFER_MS = 15_000;
const DEVICE_FRESHNESS_MS = 15_000;

export function queueSnapshotFromState(
  userId: string,
  entries: QueuePositionRow[],
  cars: QueueCar[],
  now?: Date,
): LiveQueueSnapshot {
  const index = entries.findIndex((entry) => entry.userId === userId);
  if (index < 0) throw new Error("Live queue entry is missing");
  const position = index + 1;
  const availableCars = cars.filter((car) => car.availability === "available");
  const entry = entries[index]!;
  const ready = availableCars.length > 0 && position <= availableCars.length
    && (entry.status === undefined || entry.status === "offered");
  return {
    entryId: entries[index]!.id,
    position,
    count: entries.length,
    availableCarCount: availableCars.length,
    status: ready ? "ready" : "waiting",
    offerExpiresAt: ready ? entry.expiresAt?.toISOString() ?? null : null,
    ...(now ? { serverNow: now.toISOString() } : {}),
    cars,
  };
}

export function createPostgresLiveQueueStore(databaseUrl: string, monotonicNow = () => performance.now()): LiveQueueStore {
  const { db } = createDatabase(databaseUrl);

  async function joinOrRefresh(userId: string, now: Date, explicitJoin: boolean): Promise<LiveQueueSnapshot> {
    const startedAt = monotonicNow();
    return db.transaction(async (tx) => {
      await lockLiveQueue(tx);
      now = new Date(now.getTime() + Math.max(0, monotonicNow() - startedAt));
      const state = await advanceLiveQueue(tx, now);

      const [driving] = await tx.select({
        queueEntryId: driveSessions.queueEntryId,
      }).from(driveSessions).where(and(
        eq(driveSessions.userId, userId),
        inArray(driveSessions.status, [...ACTIVE_DRIVE_SESSION_STATUSES]),
        gt(driveSessions.expiresAt, now),
      )).limit(1);
      if (driving?.queueEntryId) {
        return {
          entryId: driving.queueEntryId,
          position: 0,
          count: state.entries.length,
          availableCarCount: state.cars.filter((car) => car.availability === "available").length,
          status: "driving",
          cars: state.cars,
          offerExpiresAt: null,
          serverNow: now.toISOString(),
        };
      }

      const leaseExpiresAt = new Date(now.getTime() + QUEUE_LEASE_MS);
      const entry = state.entries.find((entry) => entry.userId === userId);
      if (!entry) {
        const [last] = await tx.select({ id: queueEntries.id, status: queueEntries.status })
          .from(queueEntries).where(eq(queueEntries.userId, userId))
          .orderBy(desc(queueEntries.joinedAt), desc(queueEntries.id)).limit(1);
        // Polling and page reloads must not silently rejoin a missed offer.
        if (!explicitJoin && last?.status === "missed") {
          return {
            entryId: last.id, position: 0, count: state.entries.length,
            availableCarCount: state.cars.filter((car) => car.availability === "available").length,
            status: "expired", cars: state.cars, offerExpiresAt: null, serverNow: now.toISOString(),
          };
        }
        await tx.insert(queueEntries).values({
          userId, status: "waiting", joinedAt: now, expiresAt: leaseExpiresAt,
          createdAt: now, updatedAt: now,
        }).onConflictDoNothing();
      } else if (entry.status === "waiting") {
        await tx.update(queueEntries).set({ expiresAt: leaseExpiresAt, updatedAt: now })
          .where(eq(queueEntries.id, entry.id));
      }
      const next = await advanceLiveQueue(tx, now);
      return queueSnapshotFromState(userId, next.entries, next.cars, now);
    });
  }

  return {
    join: (userId, now) => joinOrRefresh(userId, now, true),
    read: (userId, now) => joinOrRefresh(userId, now, false),
    async leave(userId, now) {
      const startedAt = monotonicNow();
      await db.transaction(async (tx) => {
        await lockLiveQueue(tx);
        now = new Date(now.getTime() + Math.max(0, monotonicNow() - startedAt));
        await tx.update(queueEntries)
          .set({ status: "left", updatedAt: now, expiresAt: now })
          .where(and(eq(queueEntries.userId, userId), inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES])));
        await advanceLiveQueue(tx, now);
      });
    },
  };
}

type QueueTransaction = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];

export async function lockLiveQueue(tx: QueueTransaction): Promise<void> {
  // All web replicas use the same transaction-scoped lock, including acceptance.
  await tx.execute(sql`select pg_advisory_xact_lock(1380142401, 1)`);
}

export async function advanceLiveQueue(tx: QueueTransaction, now: Date) {
  await tx.update(queueEntries).set({ status: "expired", updatedAt: now })
    .where(and(eq(queueEntries.status, "waiting"), lte(queueEntries.expiresAt, now)));
  const rows = await tx.select({
    id: queueEntries.id, userId: queueEntries.userId,
    status: queueEntries.status, expiresAt: queueEntries.expiresAt,
  }).from(queueEntries).where(inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]))
    .orderBy(asc(queueEntries.joinedAt), asc(queueEntries.id)).for("update");
  const cars = await listQueueCars(tx, now);
  const capacity = cars.filter((car) => car.availability === "available").length;
  const entries: typeof rows = [];
  for (const entry of rows) {
    const eligible = entries.length < capacity;
    if (entry.status === "offered" && eligible && entry.expiresAt <= now) {
      await tx.update(queueEntries).set({ status: "missed", updatedAt: now })
        .where(eq(queueEntries.id, entry.id));
      continue;
    }
    const status = eligible ? "offered" : "waiting";
    // Loss of capacity cancels the clock without penalizing the driver.
    if (entry.status !== status) {
      entry.status = status;
      entry.expiresAt = new Date(now.getTime() + (eligible ? QUEUE_OFFER_MS : QUEUE_LEASE_MS));
      await tx.update(queueEntries).set({ status, expiresAt: entry.expiresAt, updatedAt: now })
        .where(eq(queueEntries.id, entry.id));
    }
    entries.push(entry);
  }
  return { entries, cars };
}

async function listQueueCars(tx: QueueTransaction, now: Date): Promise<QueueCar[]> {
  const freshnessCutoff = new Date(now.getTime() - DEVICE_FRESHNESS_MS);
  const rows = await tx.selectDistinct({
    id: cars.id,
    slug: cars.slug,
    name: cars.name,
    batteryPercent: cars.batteryPercent,
    carState: cars.state,
    driveSessionId: driveSessions.id,
  }).from(cars)
    .innerJoin(devices, eq(devices.carId, cars.id))
    .leftJoin(driveSessions, and(
      eq(driveSessions.carId, cars.id),
      inArray(driveSessions.status, [...ACTIVE_DRIVE_SESSION_STATUSES]),
      gt(driveSessions.expiresAt, now),
    ))
    .where(and(
      eq(cars.adminBlocked, false),
      eq(devices.state, "AVAILABLE"),
      gt(devices.lastSeenAt, freshnessCutoff),
    ))
    .orderBy(asc(cars.name), asc(cars.id));

  return rows.map(({ carState, driveSessionId, ...car }) => ({
    ...car,
    availability: carState === "AVAILABLE" && driveSessionId === null
      ? "available"
      : "in_use",
  }));
}
