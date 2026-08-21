import { cars, createDatabase, driveSessions } from "@rc/database";
import { and, eq, gt, inArray } from "drizzle-orm";

export const ACTIVE_DRIVE_SESSION_STATUSES = ["created", "negotiating", "active"] as const;

export interface SteeringTrimStore {
  save(
    sessionId: string,
    userId: string,
    steeringTrimPercent: number,
    now: Date,
  ): Promise<boolean>;
}

export function createPostgresSteeringTrimStore(databaseUrl: string): SteeringTrimStore {
  const { db } = createDatabase(databaseUrl);
  return {
    async save(sessionId, userId, steeringTrimPercent, now) {
      return db.transaction(async (tx) => {
        const [session] = await tx
          .select({ carId: driveSessions.carId })
          .from(driveSessions)
          .where(and(
            eq(driveSessions.id, sessionId),
            eq(driveSessions.userId, userId),
            inArray(driveSessions.status, [...ACTIVE_DRIVE_SESSION_STATUSES]),
            gt(driveSessions.expiresAt, now),
          ))
          .limit(1);
        if (!session) return false;

        const [updated] = await tx
          .update(cars)
          .set({ steeringTrimPercent, updatedAt: now })
          .where(eq(cars.id, session.carId))
          .returning({ id: cars.id });
        return Boolean(updated);
      });
    },
  };
}
