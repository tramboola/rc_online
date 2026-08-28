import { readFileSync } from "node:fs";

import { IceServerSchema, type IceServer } from "@rc/contracts";
import { createSessionIceServers, signBrowserTicket } from "@rc/device-auth";

export type DriveSessionTicketInput = {
  userId: string;
  role: "user" | "admin";
  carId: string;
  sessionId: string;
  now: Date;
  secret: string;
};

type TurnIceEnvironment = {
  GATEWAY_ICE_SERVERS_JSON?: string;
  TURN_SHARED_SECRET_FILE?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
  WEBRTC_ICE_TRANSPORT_POLICY?: string;
};

export function createDriveSessionTicket(input: DriveSessionTicketInput): string {
  const iat = Math.floor(input.now.getTime() / 1_000);
  return signBrowserTicket({
    aud: "rcmania-gateway",
    sub: input.userId,
    role: input.role,
    carId: input.carId,
    sessionId: input.sessionId,
    iat,
    exp: iat + 120
  }, input.secret);
}

export function createPublicIceServers(
  subject: string,
  now: Date,
  env: TurnIceEnvironment = process.env as unknown as TurnIceEnvironment,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8")
): IceServer[] {
  const templates = readIceServerTemplates(env.GATEWAY_ICE_SERVERS_JSON);
  const secretPath = env.TURN_SHARED_SECRET_FILE?.trim();
  const secret = secretPath ? readFile(secretPath).trim() : undefined;
  const ttlSeconds = readTurnCredentialTtl(env.TURN_CREDENTIAL_TTL_SECONDS);
  return createSessionIceServers(templates, { subject, now, ttlSeconds, ...(secret ? { secret } : {}) });
}

export function readIceTransportPolicy(
  env: TurnIceEnvironment = process.env as unknown as TurnIceEnvironment
): "all" | "relay" {
  const value = env.WEBRTC_ICE_TRANSPORT_POLICY?.trim() || "all";
  if (value !== "all" && value !== "relay") {
    throw new Error("WEBRTC_ICE_TRANSPORT_POLICY must be all or relay");
  }
  return value;
}

function readIceServerTemplates(value: string | undefined): IceServer[] {
  if (!value) return [{ urls: "stun:stun.l.google.com:19302" }];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new Error("GATEWAY_ICE_SERVERS_JSON must be an array with at most eight entries");
  }
  return parsed.map((entry) => IceServerSchema.parse(entry));
}

function readTurnCredentialTtl(value: string | undefined): number {
  if (value === undefined) return 600;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3_600) {
    throw new Error("TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 3600");
  }
  return parsed;
}
