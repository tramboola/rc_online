import type { DeviceCapabilities, DeviceHealth } from "@rc/contracts";

export type PresenceState =
  | "INITIALIZING"
  | "AVAILABLE"
  | "SAFETY_BLOCKED"
  | "ADMIN_BLOCKED"
  | "OFFLINE";

export type ConsumeEnrollmentInput = {
  tokenHash: string;
  secretHash: string;
  serialNumber: string;
  agentVersion: string;
  capabilities: Record<string, unknown>;
  now: Date;
};

export type EnrollmentResult = {
  deviceId: string;
  carId: string;
};

export type AuthenticatedDevice = {
  deviceId: string;
  carId: string;
  agentVersion: string;
  capabilities: DeviceCapabilities;
};

export type DeviceUpdateOffer = {
  updateId: string;
  version: string;
  runtimeGeneration: number;
  artifactUrl: string;
  artifactSizeBytes: number;
  digestSha256: string;
  signature: string;
};

export type UpdateProgressStatus = "downloading" | "applying" | "failed";

export type ProvisionCarInput = {
  siteSlug: string;
  siteName: string;
  timezone: string;
  carSlug: string;
  carName: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
};

export type AuthorizeDriveSessionInput = {
  sessionId: string;
  userId: string;
  carId: string;
  now: Date;
};

export interface GatewayStore {
  ready(): Promise<boolean>;
  consumeEnrollment(input: ConsumeEnrollmentInput): Promise<EnrollmentResult | null>;
  authenticateDevice(
    deviceId: string,
    suppliedSecretHash: string,
    agentVersion: string,
    capabilities: DeviceCapabilities,
    now: Date
  ): Promise<AuthenticatedDevice | null>;
  claimPendingUpdate(
    deviceId: string,
    runtimeGeneration: number | null,
    now: Date
  ): Promise<DeviceUpdateOffer | null>;
  recordUpdateStatus(
    deviceId: string,
    updateId: string,
    status: UpdateProgressStatus,
    reason: string | null,
    now: Date
  ): Promise<boolean>;
  recordHeartbeat(
    deviceId: string,
    health: DeviceHealth,
    now: Date
  ): Promise<{ carId: string; adminBlocked: boolean } | null>;
  setPresenceState(deviceId: string, state: PresenceState, now: Date): Promise<void>;
  markDeviceOffline(deviceId: string, now: Date): Promise<void>;
  expireStaleDevices(cutoff: Date, now: Date): Promise<number>;
  authorizeDriveSession(input: AuthorizeDriveSessionInput): Promise<{ expiresAt: Date } | null>;
  markDriveSessionActive(sessionId: string, now: Date): Promise<boolean>;
  endDriveSession(sessionId: string, reason: string, now: Date): Promise<void>;
  expireDriveSessions(now: Date): Promise<number>;
  provisionCar(input: ProvisionCarInput): Promise<{ siteId: string; carId: string }>;
}
