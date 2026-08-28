import { timingSafeEqual } from "node:crypto";

import { createDatabase, schema, type DeviceUpdateStatus } from "@rc/database";
import type { DeviceCapabilities, DeviceHealth } from "@rc/contracts";
import { and, eq, gt, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";

import type {
  AuthenticatedDevice,
  AuthorizeDriveSessionInput,
  ConsumeEnrollmentInput,
  EnrollmentResult,
  GatewayStore,
  PresenceState,
  ProvisionCarInput,
  UpdateProgressStatus
} from "./store.js";
import { batteryCarUpdate } from "./battery-health.js";

const DRIVE_CONNECTION_TIMEOUT_MS = 20_000;
const CONNECTING_DRIVE_SESSION_STATUSES = ["created", "negotiating"] as const;

export function shouldExpireDriveSession(
  session: {
    status: "created" | "negotiating" | "active";
    expiresAt: Date;
    updatedAt: Date;
  },
  now: Date,
): boolean {
  if (session.expiresAt.getTime() <= now.getTime()) return true;
  return CONNECTING_DRIVE_SESSION_STATUSES.includes(
    session.status as (typeof CONNECTING_DRIVE_SESSION_STATUSES)[number],
  ) && session.updatedAt.getTime() <= now.getTime() - DRIVE_CONNECTION_TIMEOUT_MS;
}

export class PostgresGatewayStore implements GatewayStore {
  readonly #database: ReturnType<typeof createDatabase>;

  constructor(databaseUrl: string) {
    this.#database = createDatabase(databaseUrl);
  }

  async close(): Promise<void> {
    await this.#database.client.end();
  }

  async ready(): Promise<boolean> {
    try {
      await this.#database.client`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async consumeEnrollment(input: ConsumeEnrollmentInput): Promise<EnrollmentResult | null> {
    return this.#database.db.transaction(async (tx) => {
      const [token] = await tx
        .update(schema.deviceEnrollmentTokens)
        .set({ consumedAt: input.now })
        .where(and(
          eq(schema.deviceEnrollmentTokens.tokenHash, input.tokenHash),
          isNull(schema.deviceEnrollmentTokens.consumedAt),
          gt(schema.deviceEnrollmentTokens.expiresAt, input.now)
        ))
        .returning({ carId: schema.deviceEnrollmentTokens.carId });
      if (!token) return null;

      const [car] = await tx
        .select({ siteId: schema.cars.siteId })
        .from(schema.cars)
        .where(eq(schema.cars.id, token.carId))
        .limit(1);
      if (!car) throw new Error("Enrollment car no longer exists");

      const [device] = await tx
        .insert(schema.devices)
        .values({
          carId: token.carId,
          siteId: car.siteId,
          kind: "raspberry-pi",
          serialNumber: input.serialNumber,
          state: "INITIALIZING",
          agentVersion: input.agentVersion,
          metadata: { capabilities: input.capabilities },
          connectedAt: null,
          lastSeenAt: null,
          health: {}
        })
        .returning({ id: schema.devices.id });
      if (!device) throw new Error("Could not create device");

      await tx.insert(schema.deviceCredentials).values({
        deviceId: device.id,
        secretHash: input.secretHash,
        status: "active"
      });

      return { deviceId: device.id, carId: token.carId };
    });
  }

  async authenticateDevice(
    deviceId: string,
    suppliedSecretHash: string,
    agentVersion: string,
    capabilities: DeviceCapabilities,
    now: Date
  ): Promise<AuthenticatedDevice | null> {
    const [credential] = await this.#database.db
      .select({
        credentialId: schema.deviceCredentials.id,
        secretHash: schema.deviceCredentials.secretHash,
        carId: schema.devices.carId,
        metadata: schema.devices.metadata
      })
      .from(schema.deviceCredentials)
      .innerJoin(schema.devices, eq(schema.devices.id, schema.deviceCredentials.deviceId))
      .where(and(
        eq(schema.deviceCredentials.deviceId, deviceId),
        eq(schema.deviceCredentials.status, "active"),
        isNull(schema.deviceCredentials.revokedAt)
      ))
      .limit(1);

    if (!credential?.carId || !safeDigestEqual(suppliedSecretHash, credential.secretHash)) {
      return null;
    }
    const carId = credential.carId;

    await this.#database.db.transaction(async (tx) => {
      await tx.update(schema.deviceCredentials)
        .set({ lastAuthenticatedAt: now, updatedAt: now })
        .where(eq(schema.deviceCredentials.id, credential.credentialId));
      const existingMetadata = isRecord(credential.metadata) ? credential.metadata : {};
      await tx.update(schema.devices)
        .set({
          state: "INITIALIZING",
          connectedAt: now,
          agentVersion,
          metadata: { ...existingMetadata, capabilities: { ...capabilities } },
          updatedAt: now
        })
        .where(eq(schema.devices.id, deviceId));
      await tx.update(schema.cars)
        .set({ state: "INITIALIZING", updatedAt: now })
        .where(and(eq(schema.cars.id, carId), eq(schema.cars.adminBlocked, false)));

      const applying = await tx
        .select({
          id: schema.deviceUpdateJobs.id,
          targetVersion: schema.firmwareVersions.version
        })
        .from(schema.deviceUpdateJobs)
        .innerJoin(
          schema.firmwareVersions,
          eq(schema.firmwareVersions.id, schema.deviceUpdateJobs.firmwareVersionId)
        )
        .where(and(
          eq(schema.deviceUpdateJobs.deviceId, deviceId),
          eq(schema.deviceUpdateJobs.status, "applying")
        ));
      for (const job of applying) {
        const succeeded = job.targetVersion === agentVersion;
        await tx.update(schema.deviceUpdateJobs)
          .set({
            status: succeeded ? "succeeded" : "failed",
            failureReason: succeeded ? null : `device rolled back to ${agentVersion}`.slice(0, 256),
            finishedAt: now,
            updatedAt: now
          })
          .where(and(
            eq(schema.deviceUpdateJobs.id, job.id),
            eq(schema.deviceUpdateJobs.status, "applying")
          ));
      }
    });

    return { deviceId, carId, agentVersion, capabilities };
  }

  async claimPendingUpdate(
    deviceId: string,
    runtimeGeneration: number | null,
    now: Date
  ) {
    if (runtimeGeneration === null) return null;
    return this.#database.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          updateId: schema.deviceUpdateJobs.id,
          version: schema.firmwareVersions.version,
          runtimeGeneration: schema.firmwareVersions.runtimeGeneration,
          artifactUrl: schema.firmwareVersions.artifactUrl,
          artifactSizeBytes: schema.firmwareVersions.artifactSizeBytes,
          digestSha256: schema.firmwareVersions.digestSha256,
          signature: schema.firmwareVersions.signature
        })
        .from(schema.deviceUpdateJobs)
        .innerJoin(
          schema.firmwareVersions,
          eq(schema.firmwareVersions.id, schema.deviceUpdateJobs.firmwareVersionId)
        )
        .where(and(
          eq(schema.deviceUpdateJobs.deviceId, deviceId),
          eq(schema.deviceUpdateJobs.status, "pending"),
          eq(schema.deviceUpdateJobs.attemptCount, 0),
          eq(schema.firmwareVersions.componentKind, "pi-agent"),
          eq(schema.firmwareVersions.runtimeGeneration, runtimeGeneration)
        ))
        .limit(1);
      if (!candidate?.runtimeGeneration || !candidate.artifactUrl || !candidate.artifactSizeBytes) return null;

      const [claimed] = await tx.update(schema.deviceUpdateJobs)
        .set({ status: "downloading", attemptCount: 1, startedAt: now, updatedAt: now })
        .where(and(
          eq(schema.deviceUpdateJobs.id, candidate.updateId),
          eq(schema.deviceUpdateJobs.status, "pending"),
          eq(schema.deviceUpdateJobs.attemptCount, 0)
        ))
        .returning({ id: schema.deviceUpdateJobs.id });
      if (!claimed) return null;
      return candidate as {
        updateId: string;
        version: string;
        runtimeGeneration: number;
        artifactUrl: string;
        artifactSizeBytes: number;
        digestSha256: string;
        signature: string;
      };
    });
  }

  async recordUpdateStatus(
    deviceId: string,
    updateId: string,
    status: UpdateProgressStatus,
    reason: string | null,
    now: Date
  ): Promise<boolean> {
    const boundedReason = reason?.trim().slice(0, 256) || null;
    const allowedCurrent: DeviceUpdateStatus[] = status === "downloading"
      ? ["downloading"]
      : status === "applying"
        ? ["downloading"]
        : ["downloading", "applying"];
    const [updated] = await this.#database.db.update(schema.deviceUpdateJobs)
      .set({
        status,
        failureReason: status === "failed" ? boundedReason ?? "device rejected update" : null,
        finishedAt: status === "failed" ? now : null,
        updatedAt: now
      })
      .where(and(
        eq(schema.deviceUpdateJobs.id, updateId),
        eq(schema.deviceUpdateJobs.deviceId, deviceId),
        inArray(schema.deviceUpdateJobs.status, allowedCurrent)
      ))
      .returning({ id: schema.deviceUpdateJobs.id });
    return Boolean(updated);
  }

  async recordHeartbeat(deviceId: string, health: DeviceHealth, now: Date) {
    const [device] = await this.#database.db
      .update(schema.devices)
      .set({ health, lastSeenAt: now, updatedAt: now })
      .where(eq(schema.devices.id, deviceId))
      .returning({ carId: schema.devices.carId });
    if (!device?.carId) return null;

    const carUpdate = batteryCarUpdate(health);
    if (Object.hasOwn(carUpdate, "batteryPercent")) {
      await this.#database.db
        .update(schema.cars)
        .set({ ...carUpdate, updatedAt: now })
        .where(eq(schema.cars.id, device.carId));
    }

    const [car] = await this.#database.db
      .select({ adminBlocked: schema.cars.adminBlocked })
      .from(schema.cars)
      .where(eq(schema.cars.id, device.carId))
      .limit(1);
    return car ? { carId: device.carId, adminBlocked: car.adminBlocked } : null;
  }

  async setPresenceState(deviceId: string, state: PresenceState, now: Date): Promise<void> {
    const [device] = await this.#database.db
      .update(schema.devices)
      .set({ state, updatedAt: now })
      .where(eq(schema.devices.id, deviceId))
      .returning({ carId: schema.devices.carId });
    if (!device?.carId) return;

    const [car] = await this.#database.db
      .select({ adminBlocked: schema.cars.adminBlocked })
      .from(schema.cars)
      .where(eq(schema.cars.id, device.carId))
      .limit(1);
    const carState = car?.adminBlocked ? "ADMIN_BLOCKED" : state;
    await this.#database.db.update(schema.cars)
      .set({ state: carState, updatedAt: now })
      .where(and(
        eq(schema.cars.id, device.carId),
        notExists(
          this.#database.db.select({ id: schema.driveSessions.id })
            .from(schema.driveSessions)
            .where(and(
              eq(schema.driveSessions.carId, device.carId),
              inArray(schema.driveSessions.status, ["created", "negotiating", "active"]),
            )),
        ),
      ));
  }

  async markDeviceOffline(deviceId: string, now: Date): Promise<void> {
    const [device] = await this.#database.db
      .update(schema.devices)
      .set({ state: "OFFLINE", connectedAt: null, updatedAt: now })
      .where(eq(schema.devices.id, deviceId))
      .returning({ carId: schema.devices.carId });
    if (!device?.carId) return;

    await this.#database.db.update(schema.cars)
      .set({
        state: sql`case when ${schema.cars.adminBlocked} then 'ADMIN_BLOCKED' else 'OFFLINE' end`,
        updatedAt: now
      })
      .where(eq(schema.cars.id, device.carId));
  }

  async expireStaleDevices(cutoff: Date, now: Date): Promise<number> {
    const stale = await this.#database.db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(and(
        or(lt(schema.devices.lastSeenAt, cutoff), isNull(schema.devices.lastSeenAt)),
        sql`${schema.devices.state} <> 'OFFLINE'`
      ));
    for (const device of stale) await this.markDeviceOffline(device.id, now);
    return stale.length;
  }

  async authorizeDriveSession(input: AuthorizeDriveSessionInput): Promise<{ expiresAt: Date } | null> {
    return this.#database.db.transaction(async (tx) => {
      const [session] = await tx
        .update(schema.driveSessions)
        .set({ status: "negotiating", startedAt: input.now, updatedAt: input.now })
        .where(and(
          eq(schema.driveSessions.id, input.sessionId),
          eq(schema.driveSessions.userId, input.userId),
          eq(schema.driveSessions.carId, input.carId),
          eq(schema.driveSessions.status, "created"),
          gt(schema.driveSessions.expiresAt, input.now)
        ))
        .returning({ carId: schema.driveSessions.carId, expiresAt: schema.driveSessions.expiresAt });
      if (!session) return null;
      await tx.update(schema.cars)
        .set({ state: "CONNECTING", updatedAt: input.now })
        .where(eq(schema.cars.id, session.carId));
      return { expiresAt: session.expiresAt };
    });
  }

  async markDriveSessionActive(sessionId: string, now: Date): Promise<boolean> {
    const connectionCutoff = new Date(now.getTime() - DRIVE_CONNECTION_TIMEOUT_MS);
    return this.#database.db.transaction(async (tx) => {
      const [session] = await tx.update(schema.driveSessions)
        .set({ status: "active", updatedAt: now })
        .where(and(
          eq(schema.driveSessions.id, sessionId),
          eq(schema.driveSessions.status, "negotiating"),
          gt(schema.driveSessions.updatedAt, connectionCutoff),
          gt(schema.driveSessions.expiresAt, now)
        ))
        .returning({ carId: schema.driveSessions.carId });
      if (!session) return false;
      await tx.update(schema.cars)
        .set({ state: "ACTIVE", updatedAt: now })
        .where(eq(schema.cars.id, session.carId));
      return true;
    });
  }

  async endDriveSession(sessionId: string, _reason: string, now: Date): Promise<void> {
    await this.#database.db.transaction(async (tx) => {
      const [session] = await tx.update(schema.driveSessions)
        .set({ status: "ended", endedAt: now, updatedAt: now })
        .where(and(
          eq(schema.driveSessions.id, sessionId),
          inArray(schema.driveSessions.status, ["created", "negotiating", "active"])
        ))
        .returning({
          carId: schema.driveSessions.carId,
          queueEntryId: schema.driveSessions.queueEntryId,
        });
      if (!session) return;
      if (session.queueEntryId) {
        await tx.update(schema.queueEntries)
          .set({ status: "left", expiresAt: now, updatedAt: now })
          .where(eq(schema.queueEntries.id, session.queueEntryId));
      }
      const freshnessCutoff = new Date(now.getTime() - 15_000);
      await tx.update(schema.cars)
        .set({
          state: sql`case
            when ${schema.cars.adminBlocked} then 'ADMIN_BLOCKED'
            else coalesce((
              select ${schema.devices.state}
              from ${schema.devices}
              where ${schema.devices.carId} = ${schema.cars.id}
                and ${schema.devices.lastSeenAt} > ${freshnessCutoff}
              order by ${schema.devices.lastSeenAt} desc nulls last
              limit 1
            ), 'OFFLINE')
          end`,
          updatedAt: now,
        })
        .where(eq(schema.cars.id, session.carId));
    });
  }

  async expireDriveSessions(now: Date): Promise<number> {
    const connectionCutoff = new Date(now.getTime() - DRIVE_CONNECTION_TIMEOUT_MS);
    return this.#database.db.transaction(async (tx) => {
      const expired = await tx.update(schema.driveSessions)
        .set({ status: "ended", endedAt: now, updatedAt: now })
        .where(and(
          inArray(schema.driveSessions.status, ["created", "negotiating", "active"]),
          or(
            lte(schema.driveSessions.expiresAt, now),
            and(
              inArray(schema.driveSessions.status, [...CONNECTING_DRIVE_SESSION_STATUSES]),
              lte(schema.driveSessions.updatedAt, connectionCutoff),
            ),
          ),
        ))
        .returning({
          carId: schema.driveSessions.carId,
          queueEntryId: schema.driveSessions.queueEntryId,
        });

      const freshnessCutoff = new Date(now.getTime() - 15_000);
      for (const session of expired) {
        if (session.queueEntryId) {
          await tx.update(schema.queueEntries)
            .set({ status: "left", expiresAt: now, updatedAt: now })
            .where(eq(schema.queueEntries.id, session.queueEntryId));
        }
        await tx.update(schema.cars)
          .set({
            state: sql`case
              when ${schema.cars.adminBlocked} then 'ADMIN_BLOCKED'
              else coalesce((
                select ${schema.devices.state}
                from ${schema.devices}
                where ${schema.devices.carId} = ${schema.cars.id}
                  and ${schema.devices.lastSeenAt} > ${freshnessCutoff}
                order by ${schema.devices.lastSeenAt} desc nulls last
                limit 1
              ), 'OFFLINE')
            end`,
            updatedAt: now,
          })
          .where(eq(schema.cars.id, session.carId));
      }
      return expired.length;
    });
  }

  async provisionCar(input: ProvisionCarInput): Promise<{ siteId: string; carId: string }> {
    return this.#database.db.transaction(async (tx) => {
      await tx.insert(schema.sites).values({
        slug: input.siteSlug,
        name: input.siteName,
        timezone: input.timezone,
        status: "online"
      }).onConflictDoNothing({ target: schema.sites.slug });
      const [site] = await tx.select({ id: schema.sites.id })
        .from(schema.sites)
        .where(eq(schema.sites.slug, input.siteSlug))
        .limit(1);
      if (!site) throw new Error("Could not provision site");

      await tx.insert(schema.cars).values({
        siteId: site.id,
        slug: input.carSlug,
        name: input.carName,
        state: "OFFLINE"
      }).onConflictDoUpdate({
        target: schema.cars.slug,
        set: { name: input.carName, siteId: site.id, updatedAt: input.now }
      });
      const [car] = await tx.select({ id: schema.cars.id })
        .from(schema.cars)
        .where(eq(schema.cars.slug, input.carSlug))
        .limit(1);
      if (!car) throw new Error("Could not provision car");

      await tx.insert(schema.deviceEnrollmentTokens).values({
        carId: car.id,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.now
      });
      return { siteId: site.id, carId: car.id };
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDigestEqual(left: string, right: string): boolean {
  try {
    const first = Buffer.from(left, "base64url");
    const second = Buffer.from(right, "base64url");
    return first.length === second.length && timingSafeEqual(first, second);
  } catch {
    return false;
  }
}
