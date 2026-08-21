import {
  createDatabase,
  deviceUpdateJobs,
  devices,
  driveSessions,
  firmwareVersions,
  type DeviceUpdateStatus,
} from "@rc/database";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

export type DeviceUpdateRequestResult =
  | { kind: "created"; updateId: string }
  | { kind: "not_found" }
  | { kind: "conflict" };

export type DeviceUpdateSummary = {
  updateId: string;
  carId: string;
  version: string;
  status: DeviceUpdateStatus;
  failureReason: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type AgentRelease = {
  componentKind: unknown;
  version: unknown;
  artifactUrl: unknown;
  artifactSizeBytes: unknown;
  runtimeGeneration: unknown;
  digestSha256: unknown;
  signature: unknown;
};

export function isCompleteAgentRelease(value: AgentRelease): boolean {
  if (value.componentKind !== "pi-agent" || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(value.version)) return false;
  if (typeof value.artifactUrl !== "string") return false;
  try {
    const url = new URL(value.artifactUrl);
    if (url.protocol !== "https:" || url.origin !== "https://rcmania.live" || !url.pathname.startsWith("/agent-releases/")) return false;
  } catch {
    return false;
  }
  return typeof value.artifactSizeBytes === "number"
    && Number.isInteger(value.artifactSizeBytes)
    && value.artifactSizeBytes >= 1
    && value.artifactSizeBytes <= 8 * 1024 * 1024
    && typeof value.runtimeGeneration === "number"
    && Number.isInteger(value.runtimeGeneration)
    && value.runtimeGeneration >= 1
    && value.runtimeGeneration <= 32767
    && typeof value.digestSha256 === "string"
    && /^[0-9a-f]{64}$/u.test(value.digestSha256)
    && typeof value.signature === "string"
    && /^[A-Za-z0-9_-]{80,128}$/u.test(value.signature);
}

export interface DeviceUpdateStore {
  requestDeviceUpdate(adminId: string, carId: string, version: string, now: Date): Promise<DeviceUpdateRequestResult>;
  getLatestDeviceUpdate(carId: string): Promise<DeviceUpdateSummary | null>;
}

export function createPostgresDeviceUpdateStore(databaseUrl: string): DeviceUpdateStore {
  const { db } = createDatabase(databaseUrl);
  return {
    async requestDeviceUpdate(adminId, carId, version, now) {
      return db.transaction(async (tx): Promise<DeviceUpdateRequestResult> => {
        const [device] = await tx.select({ id: devices.id })
          .from(devices)
          .where(eq(devices.carId, carId))
          .for("update")
          .limit(1);
        if (!device) return { kind: "not_found" };

        const [release] = await tx.select({
          id: firmwareVersions.id,
          componentKind: firmwareVersions.componentKind,
          version: firmwareVersions.version,
          artifactUrl: firmwareVersions.artifactUrl,
          artifactSizeBytes: firmwareVersions.artifactSizeBytes,
          runtimeGeneration: firmwareVersions.runtimeGeneration,
          digestSha256: firmwareVersions.digestSha256,
          signature: firmwareVersions.signature,
        }).from(firmwareVersions).where(and(
          eq(firmwareVersions.componentKind, "pi-agent"),
          eq(firmwareVersions.version, version),
        )).limit(1);
        if (!release || !isCompleteAgentRelease(release)) return { kind: "not_found" };

        const [activeDrive] = await tx.select({ id: driveSessions.id }).from(driveSessions).where(and(
          eq(driveSessions.carId, carId),
          inArray(driveSessions.status, ["created", "negotiating", "active"]),
          gt(driveSessions.expiresAt, now),
        )).limit(1);
        const [activeUpdate] = await tx.select({ id: deviceUpdateJobs.id }).from(deviceUpdateJobs).where(and(
          eq(deviceUpdateJobs.deviceId, device.id),
          inArray(deviceUpdateJobs.status, ["pending", "downloading", "applying"]),
        )).limit(1);
        if (activeDrive || activeUpdate) return { kind: "conflict" };

        const [created] = await tx.insert(deviceUpdateJobs).values({
          deviceId: device.id,
          firmwareVersionId: release.id,
          requestedBy: adminId,
          requestedAt: now,
          status: "pending",
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: deviceUpdateJobs.id });
        return created ? { kind: "created", updateId: created.id } : { kind: "conflict" };
      });
    },

    async getLatestDeviceUpdate(carId) {
      const [latest] = await db.select({
        updateId: deviceUpdateJobs.id,
        carId: devices.carId,
        version: firmwareVersions.version,
        status: deviceUpdateJobs.status,
        failureReason: deviceUpdateJobs.failureReason,
        requestedAt: deviceUpdateJobs.requestedAt,
        startedAt: deviceUpdateJobs.startedAt,
        finishedAt: deviceUpdateJobs.finishedAt,
      }).from(deviceUpdateJobs)
        .innerJoin(devices, eq(devices.id, deviceUpdateJobs.deviceId))
        .innerJoin(firmwareVersions, eq(firmwareVersions.id, deviceUpdateJobs.firmwareVersionId))
        .where(eq(devices.carId, carId))
        .orderBy(desc(deviceUpdateJobs.requestedAt))
        .limit(1);
      return latest?.carId ? { ...latest, carId: latest.carId } : null;
    },
  };
}
