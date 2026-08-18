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

export type SessionIceServer = {
  urls: string | string[];
  username?: string | undefined;
  credential?: string | undefined;
};

export type TurnRestCredentials = {
  username: string;
  credential: string;
  expiresAt: Date;
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

export function createTurnRestCredentials(input: {
  secret: string;
  subject: string;
  now: Date;
  ttlSeconds?: number;
}): TurnRestCredentials {
  if (input.secret.length < 32) {
    throw new Error("TURN shared secret must contain at least 32 characters");
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(input.subject)) {
    throw new Error("TURN credential subject must contain only safe identifier characters");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new Error("TURN credential time must be valid");
  }
  const ttlSeconds = input.ttlSeconds ?? 600;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3_600) {
    throw new Error("TURN credential lifetime must be between 60 and 3600 seconds");
  }

  const expiresAt = new Date(input.now.getTime() + ttlSeconds * 1_000);
  const username = `${Math.floor(expiresAt.getTime() / 1_000)}:${input.subject}`;
  const credential = createHmac("sha1", input.secret)
    .update(username, "utf8")
    .digest("base64");
  return { username, credential, expiresAt };
}

export function createSessionIceServers(
  templates: readonly SessionIceServer[],
  input: {
    secret?: string;
    subject: string;
    now: Date;
    ttlSeconds?: number;
  }
): SessionIceServer[] {
  if (templates.some((template) => template.username !== undefined || template.credential !== undefined)) {
    throw new Error("Static ICE credentials are not allowed");
  }
  const hasTurn = templates.some((template) => urlsOf(template).some(isTurnUrl));
  if (!hasTurn) return templates.map((template) => ({ ...template }));
  if (!input.secret) throw new Error("TURN shared secret is required when TURN URLs are configured");

  const credentials = createTurnRestCredentials({
    secret: input.secret,
    subject: input.subject,
    now: input.now,
    ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds })
  });
  return templates.map((template) => urlsOf(template).some(isTurnUrl)
    ? { ...template, username: credentials.username, credential: credentials.credential }
    : { ...template });
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

function urlsOf(server: SessionIceServer): string[] {
  return typeof server.urls === "string" ? [server.urls] : server.urls;
}

function isTurnUrl(url: string): boolean {
  return url.startsWith("turn:") || url.startsWith("turns:");
}
