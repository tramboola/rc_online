import { IceServerSchema, type IceServer } from "@rc/contracts";

export type GatewayConfig = {
  host: string;
  port: number;
  publicGatewayUrl: string;
  deviceAuthPepper: string;
  browserTicketSecret: string;
  authTimeoutMs: number;
  staleAfterMs: number;
  iceServers: IceServer[];
};

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: readInteger(env.PORT, 3002, 0, 65_535),
    publicGatewayUrl: required(env.GATEWAY_PUBLIC_URL, "GATEWAY_PUBLIC_URL"),
    deviceAuthPepper: requiredSecret(env.DEVICE_AUTH_PEPPER, "DEVICE_AUTH_PEPPER"),
    browserTicketSecret: requiredSecret(env.GATEWAY_SESSION_SECRET, "GATEWAY_SESSION_SECRET"),
    authTimeoutMs: readInteger(env.GATEWAY_AUTH_TIMEOUT_MS, 5_000, 100, 30_000),
    staleAfterMs: readInteger(env.GATEWAY_STALE_AFTER_MS, 15_000, 5_000, 120_000),
    iceServers: parseIceServers(env.GATEWAY_ICE_SERVERS_JSON)
  };
}

function parseIceServers(value: string | undefined): IceServer[] {
  if (!value) return [{ urls: "stun:stun.l.google.com:19302" }];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new Error("GATEWAY_ICE_SERVERS_JSON must be an array with at most eight entries");
  }
  return parsed.map((entry) => IceServerSchema.parse(entry));
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecret(value: string | undefined, name: string): string {
  const result = required(value, name);
  if (result.length < 24) throw new Error(`${name} must contain at least 24 characters`);
  return result;
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}
