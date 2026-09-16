import { createDatabase, users } from "@rc/database";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { StoredAudioPreferences } from "./ride-audio-preferences";

export interface AudioPreferencesStore {
  get(userId: string): Promise<StoredAudioPreferences | null>;
  save(userId: string, value: StoredAudioPreferences): Promise<{
    saved: boolean;
    preferences: StoredAudioPreferences;
  } | null>;
}

export function createPostgresAudioPreferencesStore(databaseUrl: string): AudioPreferencesStore {
  return createAudioPreferencesStore(createDatabase(databaseUrl).db);
}

export function createAudioPreferencesStore(db: ReturnType<typeof createDatabase>["db"]): AudioPreferencesStore {
  const columns = {
    volumePercent: users.onboardVolumePercent,
    muted: users.onboardMuted,
    revision: users.onboardAudioRevision,
  };
  const ownActiveUser = (userId: string) => and(eq(users.id, userId), isNull(users.disabledAt));
  const get: AudioPreferencesStore["get"] = async (userId) => {
    const [value] = await db.select(columns).from(users).where(ownActiveUser(userId)).limit(1);
    return value ?? null;
  };
  return {
    get,
    async save(userId, value) {
      const [saved] = await db.update(users).set({
        onboardVolumePercent: value.volumePercent,
        onboardMuted: value.muted,
        onboardAudioRevision: sql`${users.onboardAudioRevision} + 1`,
      }).where(and(ownActiveUser(userId), eq(users.onboardAudioRevision, value.revision))).returning(columns);
      if (saved) return { saved: true, preferences: saved };
      const current = await get(userId);
      return current ? { saved: false, preferences: current } : null;
    },
  };
}
