import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export type BrowserTicketPayload = {
  aud: "rcmania-gateway";
  sub: string;
  role: "admin";
  carId: string;
  sessionId: string;
  iat: number;
  exp: number;
};

const ticketFields = ["aud", "sub", "role", "carId", "sessionId", "iat", "exp"] as const;

export function generateOpaqueSecret(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new Error("Opaque secrets must contain at least 16 random bytes");
  }

  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueSecret(secret: string, pepper: string): string {
  assertNonEmpty(secret, "secret");
  assertNonEmpty(pepper, "pepper");
  return createHmac("sha256", pepper).update(secret, "utf8").digest("base64url");
}

export function verifyOpaqueSecret(secret: string, digest: string, pepper: string): boolean {
  try {
    const actual = Buffer.from(hashOpaqueSecret(secret, pepper), "base64url");
    const expected = Buffer.from(digest, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function signBrowserTicket(payload: BrowserTicketPayload, secret: string): string {
  assertNonEmpty(secret, "ticket secret");
  validateBrowserTicketPayload(payload);

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyBrowserTicket(
  ticket: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000)
): BrowserTicketPayload {
  assertNonEmpty(secret, "ticket secret");
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid browser ticket format");
  }

  const [body, encodedSignature] = parts as [string, string];
  const actualSignature = Buffer.from(sign(body, secret), "base64url");
  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  if (
    actualSignature.length !== suppliedSignature.length ||
    !timingSafeEqual(actualSignature, suppliedSignature)
  ) {
    throw new Error("Invalid browser ticket signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid browser ticket payload");
  }

  validateBrowserTicketPayload(payload);
  if (payload.aud !== "rcmania-gateway") {
    throw new Error("Invalid browser ticket audience");
  }
  if (nowSeconds > payload.exp) {
    throw new Error("Browser ticket expired");
  }
  if (nowSeconds < payload.iat) {
    throw new Error("Browser ticket was issued in the future");
  }

  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

function validateBrowserTicketPayload(value: unknown): asserts value is BrowserTicketPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid browser ticket payload");
  }

  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).length !== ticketFields.length ||
    !ticketFields.every((field) => Object.hasOwn(payload, field)) ||
    typeof payload.aud !== "string" ||
    typeof payload.sub !== "string" ||
    payload.role !== "admin" ||
    typeof payload.carId !== "string" ||
    typeof payload.sessionId !== "string" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    (payload.iat as number) >= (payload.exp as number) ||
    payload.sub.length === 0 ||
    payload.carId.length === 0 ||
    payload.sessionId.length === 0
  ) {
    throw new Error("Invalid browser ticket payload");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
}
