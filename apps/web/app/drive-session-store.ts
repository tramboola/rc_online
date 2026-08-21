import { cars, createDatabase, devices, driveSessions } from "@rc/database";
import { and, eq, gt, inArray } from "drizzle-orm";

export type CreatedDriveSession = {
  sessionId: string;
  expiresAt: Date;
  steeringTrimPercent: number;
  controlProtocolVersion: 3 | 4;
};

export const DRIVE_SESSION_DURATION_MS = 5 * 60_000;

export function driveSessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + DRIVE_SESSION_DURATION_MS);
}

export interface DriveSessionStore {
  create(userId: string, carId: string, now: Date): Promise<CreatedDriveSession | null>;
}

export function controlProtocolVersionFromMetadata(metadata: unknown): 3 | 4 {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return 3;
  const capabilities = (metadata as Record<string, unknown>).capabilities;
  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) return 3;
  return (capabilities as Record<string, unknown>).controlProtocolVersion === 4 ? 4 : 3;
}

export function createPostgresDriveSessionStore(databaseUrl: string): DriveSessionStore {
  const { db } = createDatabase(databaseUrl);
  return {
    async create(userId, carId, now) {
      return db.transaction(async (tx) => {
        const freshnessCutoff = new Date(now.getTime() - 15_000);
        const [available] = await tx
          .select({
            carId: cars.id,
            steeringTrimPercent: cars.steeringTrimPercent,
            deviceMetadata: devices.metadata,
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
            eq(driveSessions.carId, carId)
          ))
          .limit(1);
        if (existing) return null;

        const expiresAt = driveSessionExpiresAt(now);
        const [session] = await tx.insert(driveSessions).values({
          userId,
          carId,
          status: "created",
          expiresAt,
          createdAt: now,
          updatedAt: now
        }).returning({ id: driveSessions.id });
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
