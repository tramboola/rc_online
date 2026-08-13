import type { IceServer } from "@rc/contracts";
import { signBrowserTicket } from "@rc/device-auth";

export type DriveSessionTicketInput = {
  userId: string;
  carId: string;
  sessionId: string;
  now: Date;
  secret: string;
};

export function createDriveSessionTicket(input: DriveSessionTicketInput): string {
  const iat = Math.floor(input.now.getTime() / 1_000);
  return signBrowserTicket({
    aud: "rcmania-gateway",
    sub: input.userId,
    role: "admin",
    carId: input.carId,
    sessionId: input.sessionId,
    iat,
    exp: iat + 120
  }, input.secret);
}

export function readPublicIceServers(env: NodeJS.ProcessEnv = process.env): IceServer[] {
  if (!env.GATEWAY_ICE_SERVERS_JSON) return [{ urls: "stun:stun.l.google.com:19302" }];
  const value: unknown = JSON.parse(env.GATEWAY_ICE_SERVERS_JSON);
  if (!Array.isArray(value)) throw new Error("GATEWAY_ICE_SERVERS_JSON must be an array");
  return value as IceServer[];
}
