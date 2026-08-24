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

type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413 };

async function safelyCancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // A transport error must not replace the bounded request response.
  }
}

async function readBoundedUtf8Body(
  request: Request,
): Promise<BoundedBodyResult> {
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumAccountBodyBytes) {
        try {
          await reader.cancel();
        } catch {
          // A transport error must not replace the 413 response.
        }
        return { ok: false, status: 413 };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be errored or closed.
    }
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
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
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null
    ? undefined
    : Number(contentLengthHeader);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maximumAccountBodyBytes) {
    await safelyCancelBody(request.body);
    return { ok: false, response: errorResponse(413) };
  }
  const clientIp = request.headers.get("x-real-ip")?.trim() ?? "";
  if (clientIp.includes(",") || isIP(clientIp) === 0) {
    return { ok: false, response: errorResponse(400) };
  }

  const boundedBody = await readBoundedUtf8Body(request);
  if (!boundedBody.ok) {
    return { ok: false, response: errorResponse(boundedBody.status) };
  }
  let body: unknown;
  try {
    body = JSON.parse(boundedBody.text) as unknown;
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
