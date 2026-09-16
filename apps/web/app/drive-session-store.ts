import { cars, createDatabase, devices, driveSessions, queueEntries } from "@rc/database";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { advanceLiveQueue, lockLiveQueue } from "./live-queue-store";

export type CreatedDriveSession = {
  sessionId: string;
  expiresAt: Date;
  steeringTrimPercent: number;
  controlProtocolVersion: 3 | 4 | 5;
};

export const DRIVE_SESSION_DURATION_MS = 5 * 60_000;

export function driveSessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + DRIVE_SESSION_DURATION_MS);
}

export interface DriveSessionStore {
  create(userId: string, carId: string, now: Date): Promise<CreatedDriveSession | null>;
}

export function controlProtocolVersionFromMetadata(metadata: unknown): 3 | 4 | 5 {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return 3;
  const capabilities = (metadata as Record<string, unknown>).capabilities;
  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) return 3;
  const version = (capabilities as Record<string, unknown>).controlProtocolVersion;
  return version === 5 ? 5 : version === 4 ? 4 : 3;
}

export function createPostgresDriveSessionStore(databaseUrl: string, monotonicNow = () => performance.now()): DriveSessionStore {
  const { db } = createDatabase(databaseUrl);
  return {
    async create(userId, carId, now) {
      const requestedAt = now.getTime();
      const startedAt = monotonicNow();
      const currentTime = () => new Date(requestedAt + Math.max(0, monotonicNow() - startedAt));
      return db.transaction(async (tx) => {
        await lockLiveQueue(tx);
        now = currentTime();
        const queue = await advanceLiveQueue(tx, now);
        const entry = queue.entries.find((entry) => entry.userId === userId);
        if (entry?.status !== "offered" || entry.expiresAt <= now) return null;
        const freshnessCutoff = new Date(now.getTime() - 15_000);

        const [available] = await tx
          .select({
            carId: cars.id,
            steeringTrimPercent: cars.steeringTrimPercent,
            deviceMetadata: devices.metadata,
            deviceLastSeenAt: devices.lastSeenAt,
          })
          .from(cars)
          .innerJoin(devices, eq(devices.carId, cars.id))
          .where(and(
            eq(cars.id, carId),
            eq(cars.state, "AVAILABLE"),
            eq(cars.adminBlocked, false),
            eq(devices.state, "AVAILABLE"),
            gt(devices.lastSeenAt, freshnessCutoff)
          ))
          .for("update")
          .limit(1);
        if (!available) return null;

        const [existing] = await tx
          .select({ id: driveSessions.id })
          .from(driveSessions)
          .where(and(
            inArray(driveSessions.status, ["created", "negotiating", "active"]),
            gt(driveSessions.expiresAt, now),
            or(eq(driveSessions.carId, carId), eq(driveSessions.userId, userId))
          ))
          .limit(1);
        if (existing) return null;

        // Device/car row locks may wait behind a heartbeat or session cleanup.
        now = currentTime();
        if (entry.expiresAt <= now) {
          await advanceLiveQueue(tx, now);
          return null;
        }
        if (!available.deviceLastSeenAt || available.deviceLastSeenAt.getTime() <= now.getTime() - 15_000) return null;
        const expiresAt = driveSessionExpiresAt(now);
        const [session] = await tx.insert(driveSessions).values({
          userId,
          carId,
          queueEntryId: entry.id,
          status: "created",
          expiresAt,
          createdAt: now,
          updatedAt: now
        }).onConflictDoNothing().returning({ id: driveSessions.id });
        if (!session) return null;
        await tx.update(queueEntries)
          .set({ status: "accepted", updatedAt: now })
          .where(eq(queueEntries.id, entry.id));
        await tx.update(cars)
          .set({ state: "RESERVED", updatedAt: now })
          .where(eq(cars.id, carId));
        return session ? {
          sessionId: session.id,
          expiresAt,
          steeringTrimPercent: available.steeringTrimPercent,
          controlProtocolVersion: controlProtocolVersionFromMetadata(available.deviceMetadata),
        } : null;
      });
    }
  };
}
