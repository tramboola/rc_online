import { readFile } from "node:fs/promises";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as postgresStore from "./postgres-store.js";

const { shouldExpireDriveSession } = postgresStore;

describe("shouldExpireDriveSession", () => {
  const now = new Date("2026-08-28T18:00:00.000Z");

  it.each(["created", "negotiating"] as const)(
    "expires a stale %s session after the connection window",
    (status) => {
      expect(shouldExpireDriveSession({
        status,
        expiresAt: new Date("2026-08-28T18:05:00.000Z"),
        updatedAt: new Date("2026-08-28T17:59:39.999Z"),
      }, now)).toBe(true);
    },
  );

  it("keeps an active session until its actual expiry", () => {
    expect(shouldExpireDriveSession({
      status: "active",
      expiresAt: new Date("2026-08-28T18:05:00.000Z"),
      updatedAt: new Date("2026-08-28T17:55:00.000Z"),
    }, now)).toBe(false);
  });

  it("expires every live status at the session deadline", () => {
    expect(shouldExpireDriveSession({
      status: "active",
      expiresAt: now,
      updatedAt: new Date("2026-08-28T17:59:59.000Z"),
    }, now)).toBe(true);
  });

  it("builds the car release query with a driver-safe timestamp", () => {
    const freshDeviceStateSql = (
      postgresStore as typeof postgresStore & {
        freshDeviceStateSql?: (value: Date) => SQL;
      }
    ).freshDeviceStateSql;

    expect(freshDeviceStateSql).toBeTypeOf("function");
    const query = new PgDialect().sqlToQuery(
      freshDeviceStateSql!(new Date("2026-08-31T11:55:25.000Z")),
    );
    expect(query.params).toEqual(["2026-08-31T11:55:25.000Z"]);
  });

  it("claims stale rows with a conditional update instead of a select-then-end race", async () => {
    const source = await readFile(new URL("./postgres-store.ts", import.meta.url), "utf8");
    const methodStart = source.indexOf("  async expireDriveSessions(now: Date)");
    const methodEnd = source.indexOf("  async provisionCar", methodStart);
    const method = source.slice(methodStart, methodEnd);

    expect(method).toContain(".update(schema.driveSessions)");
    expect(method).toContain(".returning({");
    expect(method).not.toContain(".select({ id: schema.driveSessions.id })");
    expect(method).not.toContain("this.endDriveSession(");
  });

  it("does not let a heartbeat free a car before its session is explicitly ended", async () => {
    const source = await readFile(new URL("./postgres-store.ts", import.meta.url), "utf8");
    const methodStart = source.indexOf("  async setPresenceState(");
    const methodEnd = source.indexOf("  async markDeviceOffline", methodStart);
    const method = source.slice(methodStart, methodEnd);

    expect(method).toContain("inArray(schema.driveSessions.status");
    expect(method).not.toContain("schema.driveSessions.expiresAt");
  });
});
