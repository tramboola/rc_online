import { readFile } from "node:fs/promises";

import { createDatabase } from "@rc/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAudioPreferencesStore } from "./audio-preferences-store";

const databaseUrl = process.env.RC_AUDIO_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("onboard audio preferences in disposable PostgreSQL", () => {
  let database: ReturnType<typeof createDatabase>;
  let store: ReturnType<typeof createAudioPreferencesStore>;
  const firstId = "10000000-0000-4000-8000-000000000001";
  const secondId = "10000000-0000-4000-8000-000000000002";
  const disabledId = "10000000-0000-4000-8000-000000000003";

  beforeAll(async () => {
    if (!databaseUrl || !/^\/rc_audio_test(?:_[a-z0-9_]+)?$/.test(new URL(databaseUrl).pathname)) {
      throw new Error("RC_AUDIO_TEST_DATABASE_URL must target a disposable rc_audio_test database");
    }
    database = createDatabase(databaseUrl);
    // Start with the relevant pre-migration user columns in a new, empty test DB.
    await database.client.unsafe("CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL, disabled_at timestamptz)");
    await database.client`INSERT INTO users (id, email, disabled_at) VALUES
      (${firstId}, 'first@example.invalid', null),
      (${secondId}, 'second@example.invalid', null),
      (${disabledId}, 'disabled@example.invalid', now())`;
    await database.client.unsafe(await readFile(new URL("../../../packages/database/migrations/0009_user_audio_preferences.sql", import.meta.url), "utf8"));
    store = createAudioPreferencesStore(database.db);
  });
  afterAll(async () => { await database?.client.end(); });

  it("backfills existing accounts and persists each account independently", async () => {
    expect(await store.get(firstId)).toEqual({ volumePercent: 100, muted: false, revision: 0 });
    expect(await store.save(firstId, { volumePercent: 0, muted: true, revision: 0 })).toEqual({
      saved: true, preferences: { volumePercent: 0, muted: true, revision: 1 },
    });
    expect(await store.get(firstId)).toEqual({ volumePercent: 0, muted: true, revision: 1 });
    expect(await store.get(secondId)).toEqual({ volumePercent: 100, muted: false, revision: 0 });
  });

  it("atomically accepts one concurrent revision and rejects the stale writer", async () => {
    const results = await Promise.all([
      store.save(secondId, { volumePercent: 10, muted: false, revision: 0 }),
      store.save(secondId, { volumePercent: 90, muted: true, revision: 0 }),
    ]);
    expect(results.filter((result) => result?.saved)).toHaveLength(1);
    const current = await store.get(secondId);
    expect(current?.revision).toBe(1);
    expect(results.find((result) => result?.saved)?.preferences).toEqual(current);
    expect(results.find((result) => !result?.saved)?.preferences).toEqual(current);
  });

  it("cannot read or write a disabled account", async () => {
    expect(await store.get(disabledId)).toBeNull();
    expect(await store.save(disabledId, { volumePercent: 20, muted: true, revision: 0 })).toBeNull();
    const [row] = await database.client`SELECT onboard_volume_percent, onboard_muted, onboard_audio_revision FROM users WHERE id = ${disabledId}`;
    expect(row).toEqual({ onboard_volume_percent: 100, onboard_muted: false, onboard_audio_revision: 0 });
  });

  it("enforces the volume and revision bounds in SQL", async () => {
    await expect(database.client`UPDATE users SET onboard_volume_percent = -1 WHERE id = ${firstId}`).rejects.toMatchObject({ code: "23514" });
    await expect(database.client`UPDATE users SET onboard_volume_percent = 101 WHERE id = ${firstId}`).rejects.toMatchObject({ code: "23514" });
    await expect(database.client`UPDATE users SET onboard_audio_revision = -1 WHERE id = ${firstId}`).rejects.toMatchObject({ code: "23514" });
    expect(await store.get(firstId)).toEqual({ volumePercent: 0, muted: true, revision: 1 });
  });
});
