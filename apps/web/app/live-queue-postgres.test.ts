import { readFile, readdir } from "node:fs/promises";
import { createDatabase } from "@rc/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresLiveQueueStore } from "./live-queue-store";
import { createPostgresDriveSessionStore } from "./drive-session-store";

// Opt-in: only a disposable local database, never DATABASE_URL or production.
const databaseUrl = process.env.QUEUE_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.startsWith('/rcmania_queue_test_')) {
    throw new Error('Queue integration tests require a disposable local rcmania_queue_test_* database');
  }
}

describe.skipIf(!databaseUrl)('live queue on PostgreSQL', () => {
  const database = databaseUrl ? createDatabase(databaseUrl) : undefined;
  const sql = database?.client;
  const queue = databaseUrl ? createPostgresLiveQueueStore(databaseUrl, () => 0) : undefined;
  const drive = databaseUrl ? createPostgresDriveSessionStore(databaseUrl, () => 0) : undefined;
  const first = '10000000-0000-4000-8000-000000000001';
  const second = '10000000-0000-4000-8000-000000000002';
  const car = '20000000-0000-4000-8000-000000000001';
  const site = '30000000-0000-4000-8000-000000000001';
  const at = (seconds: number) => new Date(Date.UTC(2030, 0, 1, 12, 0, seconds));

  beforeAll(async () => {
    const [schema] = await sql!`select count(*)::int as count from information_schema.tables where table_schema='public' and table_name='users'`;
    if (schema?.count === 0) {
      // Resolve from this app file, not from the shell's cwd.
      const folder = new URL('../../../packages/database/migrations/', import.meta.url);
      for (const name of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
        await sql!.unsafe(await readFile(new URL(name, folder), 'utf8'));
      }
    }
  }, 30_000);

  beforeEach(async () => {
    await sql!`truncate drive_sessions, queue_entries, devices, cars, sites, users cascade`;
    await sql!`insert into users(id,email,display_name) values (${first},'first@example.test','First'),(${second},'second@example.test','Second')`;
    await sql!`insert into sites(id,slug,name,timezone,status) values (${site},'queue-test','Queue Test','UTC','online')`;
    await sql!`insert into cars(id,site_id,slug,name,state,battery_percent) values (${car},${site},'rc-mania-one','RC Mania One','AVAILABLE',47)`;
    await sql!`insert into devices(car_id,site_id,kind,serial_number,state,last_seen_at) values (${car},${site},'pi','queue-test-pi','AVAILABLE',${at(0).toISOString()})`;
  });
  afterAll(async () => { await sql?.end(); });
  async function tick(seconds: number) {
    await sql!`update devices set last_seen_at=${at(seconds).toISOString()}`;
    return at(seconds);
  }

  it('gives exactly 15 seconds and polling or joining again cannot extend the offer', async () => {
    expect(await queue!.join(first, at(0))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:15.000Z' });
    expect(await queue!.read(first, await tick(10))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:15.000Z' });
    expect(await queue!.join(first, await tick(14))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:15.000Z' });
  });

  it('hands a missed offer to the next user and polling never rejoins the absent driver', async () => {
    await queue!.join(first, at(0));
    await queue!.join(second, at(1));
    expect(await queue!.read(second, await tick(15))).toMatchObject({ status: 'ready', position: 1, count: 1, offerExpiresAt: '2030-01-01T12:00:30.000Z' });
    expect(await queue!.read(first, await tick(16))).toMatchObject({ status: 'expired', position: 0, count: 1 });
    expect(await queue!.read(first, await tick(17))).toMatchObject({ status: 'expired', position: 0, count: 1 });
    expect(await queue!.join(first, await tick(18))).toMatchObject({ status: 'waiting', position: 2, count: 2 });
  });

  it('rejects accepting exactly at the deadline and releases the slot without a polling request', async () => {
    await queue!.join(first, at(0));
    await queue!.join(second, at(1));
    expect(await drive!.create(first, car, await tick(15))).toBeNull();
    expect(await drive!.create(second, car, at(15))).toMatchObject({ sessionId: expect.any(String) });
    const [row] = await sql!`select count(*)::int as count from drive_sessions`;
    expect(row?.count).toBe(1);
  });

  it('accepts just before the deadline and does not create a second ride for one car', async () => {
    await queue!.join(first, at(0));
    await queue!.join(second, at(1));
    const results = await Promise.all([
      drive!.create(first, car, await tick(14)),
      drive!.create(first, car, at(14)),
      drive!.create(second, car, at(14)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[2]).toBeNull();
    expect(await queue!.read(second, at(14))).toMatchObject({ status: 'waiting', availableCarCount: 0 });
  });

  it('does not spend the acceptance window while all cars are unavailable', async () => {
    await sql!`update cars set state='OFFLINE'`;
    expect(await queue!.join(first, at(0))).toMatchObject({ status: 'waiting', offerExpiresAt: null });
    expect(await queue!.read(first, await tick(20))).toMatchObject({ status: 'waiting' });
    await sql!`update cars set state='AVAILABLE'`;
    expect(await queue!.read(first, await tick(21))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:36.000Z' });
  });

  it('cancels the offer if the car goes offline and grants a fresh window after recovery', async () => {
    await queue!.join(first, at(0));
    await sql!`update devices set state='OFFLINE'`;
    expect(await queue!.read(first, await tick(10))).toMatchObject({ status: 'waiting', offerExpiresAt: null });
    await sql!`update devices set state='AVAILABLE'`;
    expect(await queue!.read(first, await tick(20))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:35.000Z' });
  });

  it('offers the released car to the next user after a failed or early-ended ride', async () => {
    await queue!.join(first, at(0));
    await queue!.join(second, at(1));
    const session = await drive!.create(first, car, at(2));
    await sql!`update drive_sessions set status='ended', ended_at=${at(8).toISOString()} where id=${session!.sessionId}`;
    await sql!`update queue_entries set status='left' where user_id=${first}`;
    await sql!`update cars set state='AVAILABLE'`;
    expect(await queue!.read(second, await tick(8))).toMatchObject({ status: 'ready', position: 1, offerExpiresAt: '2030-01-01T12:00:23.000Z' });
  });

  it.each([
    [0, 2000], // Time spent waiting for the queue lock.
    [0, 0, 2000], // Time spent waiting for the car/device lock.
  ])('includes lock wait time when checking the acceptance deadline (%j)', async (...elapsed) => {
    await queue!.join(first, at(0));
    await queue!.join(second, at(1));
    const delayedDrive = createPostgresDriveSessionStore(databaseUrl!, () => elapsed.shift() ?? 2000);
    expect(await delayedDrive.create(first, car, await tick(14))).toBeNull();
    expect(await queue!.read(second, at(16))).toMatchObject({ status: 'ready', position: 1 });
  });

  it('allows parallel offers for two cars but never two rides for one driver', async () => {
    const otherCar = '20000000-0000-4000-8000-000000000002';
    await sql!`insert into cars(id,site_id,slug,name,state) values (${otherCar},${site},'two','Second car','AVAILABLE')`;
    await sql!`insert into devices(car_id,site_id,kind,serial_number,state,last_seen_at) values (${otherCar},${site},'pi','queue-test-pi-2','AVAILABLE',${at(0).toISOString()})`;
    await queue!.join(first, at(0));
    expect(await queue!.join(second, at(1))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:16.000Z' });
    const sessions = await Promise.all([drive!.create(first, car, at(2)), drive!.create(first, otherCar, at(2))]);
    expect(sessions.filter(Boolean)).toHaveLength(1);
    expect(await queue!.read(second, at(3))).toMatchObject({ status: 'ready', offerExpiresAt: '2030-01-01T12:00:16.000Z' });
  });

  it.each(['read', 'join'] as const)('%s keeps the actual fleet for an active driver without rejoining', async (method) => {
    const otherCar = '20000000-0000-4000-8000-000000000002';
    await sql!`insert into cars(id,site_id,slug,name,state) values (${otherCar},${site},'two','Second car','AVAILABLE')`;
    await sql!`insert into devices(car_id,site_id,kind,serial_number,state,last_seen_at) values (${otherCar},${site},'pi','queue-test-pi-2','AVAILABLE',${at(0).toISOString()})`;
    await queue!.join(first, at(0));
    await drive!.create(first, car, at(1));
    await queue!.join(second, at(2));
    const snapshot = await queue![method](first, at(3));
    expect(snapshot).toMatchObject({ status: 'driving', position: 0, count: 1, availableCarCount: 1 });
    expect(snapshot.cars).toHaveLength(2);
    expect(snapshot.cars).toContainEqual(expect.objectContaining({ id: car, availability: 'in_use' }));
    expect(snapshot.cars).toContainEqual(expect.objectContaining({ id: otherCar, availability: 'available' }));
    const [entry] = await sql!`select count(*)::int as count from queue_entries where user_id=${first} and status in ('waiting','offered')`;
    expect(entry!.count).toBe(0);
  });

  it('rejects a heartbeat that became stale while waiting for the car lock', async () => {
    await queue!.join(first, at(10));
    const elapsed = [0, 0, 5000];
    const delayedDrive = createPostgresDriveSessionStore(databaseUrl!, () => elapsed.shift() ?? 5000);
    expect(await delayedDrive.create(first, car, at(14))).toBeNull();
    const [row] = await sql!`select count(*)::int as count from drive_sessions`;
    expect(row?.count).toBe(0);
  });
});
