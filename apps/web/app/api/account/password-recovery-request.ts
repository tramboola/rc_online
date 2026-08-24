import { isIP } from "node:net";

import { z } from "zod";

import { hashRateLimitKey } from "../../../auth/rate-limit";

const maximumPasswordRecoveryBodyBytes = 4_096;

type ParsedPasswordRecoveryRequest<T> =
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

async function readBoundedRequestText(request: Request): Promise<string | Response> {
  const reader = request.body?.getReader();
  if (!reader) return errorResponse(400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumPasswordRecoveryBodyBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size rejection remains authoritative if the source cannot cancel cleanly.
        }
        return errorResponse(413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      await reader.cancel();
    } catch {
      // A malformed or failed source still maps to one generic request error.
    }
    return errorResponse(400);
  } finally {
    reader.releaseLock();
  }
}

export async function readPasswordRecoveryPost<T>(
  request: Request,
  schema: z.ZodType<T>,
  canonicalOrigin: string,
): Promise<ParsedPasswordRecoveryRequest<T>> {
  if (request.headers.get("origin") !== canonicalOrigin) {
    return { ok: false, response: errorResponse(403) };
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, response: errorResponse(415) };
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumPasswordRecoveryBodyBytes) {
    return { ok: false, response: errorResponse(413) };
  }
  const clientIp = request.headers.get("x-real-ip")?.trim() ?? "";
  if (clientIp.includes(",") || isIP(clientIp) === 0) {
    return { ok: false, response: errorResponse(400) };
  }
  const text = await readBoundedRequestText(request);
  if (text instanceof Response) return { ok: false, response: text };
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

export function passwordRecoveryRateLimitKeys(
  secret: string,
  clientIp: string,
  accountReference: string,
) {
  return {
    ipKeyHash: hashRateLimitKey(secret, `ip:${clientIp}`),
    accountKeyHash: hashRateLimitKey(secret, `account:${accountReference}`),
  };
}
