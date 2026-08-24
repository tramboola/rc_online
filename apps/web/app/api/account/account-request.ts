import { isIP } from "node:net";

import { z } from "zod";

import { hashRateLimitKey } from "../../../auth/rate-limit";

const maximumAccountBodyBytes = 4_096;

type ParsedAccountRequest<T> =
  | { ok: true; data: T; clientIp: string }
  | { ok: false; response: Response };

function errorResponse(status: number): Response {
  const message = status === 403
    ? "Cross-origin request rejected."
    : status === 413
      ? "Request is too large."
      : status === 415
        ? "JSON request required."
        : "Invalid request.";
  return Response.json({ ok: false, message }, { status });
}

export async function readAccountPost<T>(
  request: Request,
  schema: z.ZodType<T>,
  canonicalOrigin: string,
): Promise<ParsedAccountRequest<T>> {
  if (request.headers.get("origin") !== canonicalOrigin) {
    return { ok: false, response: errorResponse(403) };
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, response: errorResponse(415) };
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumAccountBodyBytes) {
    return { ok: false, response: errorResponse(413) };
  }
  const clientIp = request.headers.get("x-real-ip")?.trim() ?? "";
  if (clientIp.includes(",") || isIP(clientIp) === 0) {
    return { ok: false, response: errorResponse(400) };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400) };
  }
  if (new TextEncoder().encode(text).byteLength > maximumAccountBodyBytes) {
    return { ok: false, response: errorResponse(413) };
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, response: errorResponse(400) };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data, clientIp }
    : { ok: false, response: errorResponse(400) };
}

export function accountRateLimitKeys(
  secret: string,
  clientIp: string,
  normalizedEmail: string,
) {
  return {
    ipKeyHash: hashRateLimitKey(secret, `ip:${clientIp}`),
    accountKeyHash: hashRateLimitKey(secret, `account:${normalizedEmail}`),
  };
}

export const acceptedAccountResponse = () => Response.json({
  ok: true,
  message: "If this email can be used, check your inbox.",
}, { status: 202 });

export const rateLimitedAccountResponse = () => Response.json({
  ok: false,
  message: "Too many attempts. Try again later.",
}, { status: 429 });

export function normalizeAccountRouteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function passwordHasPolicyLength(password: string): boolean {
  const length = [...password].length;
  return length >= 12 && length <= 128;
}
