import type { DeviceHealth } from "@rc/contracts";

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
};

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
    now: Date
  ): Promise<AuthenticatedDevice | null>;
  recordHeartbeat(
    deviceId: string,
    health: DeviceHealth,
    now: Date
  ): Promise<{ carId: string; adminBlocked: boolean } | null>;
  setPresenceState(deviceId: string, state: PresenceState, now: Date): Promise<void>;
  markDeviceOffline(deviceId: string, now: Date): Promise<void>;
  expireStaleDevices(cutoff: Date, now: Date): Promise<number>;
  authorizeDriveSession(input: AuthorizeDriveSessionInput): Promise<{ expiresAt: Date } | null>;
  endDriveSession(sessionId: string, reason: string, now: Date): Promise<void>;
  provisionCar(input: ProvisionCarInput): Promise<{ siteId: string; carId: string }>;
}
