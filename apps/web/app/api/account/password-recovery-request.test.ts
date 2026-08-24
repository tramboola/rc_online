import { describe, expect, test } from "vitest";
import { z } from "zod";

import { readPasswordRecoveryPost } from "./password-recovery-request";

const origin = "https://rcmania.live";

function streamedRequest(bytes: Uint8Array) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Request(`${origin}/api/account/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": "203.0.113.24" },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("password recovery request reader", () => {
  test("rejects malformed UTF-8 and releases the request stream lock", async () => {
    const prefix = new TextEncoder().encode('{"value":"');
    const suffix = new TextEncoder().encode('"}');
    const bytes = new Uint8Array(prefix.length + 2 + suffix.length);
    bytes.set(prefix);
    bytes.set([0xc3, 0x28], prefix.length);
    bytes.set(suffix, prefix.length + 2);
    const request = streamedRequest(bytes);

    const parsed = await readPasswordRecoveryPost(
      request,
      z.object({ value: z.string() }).strict(),
      origin,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
    expect(request.body?.locked).toBe(false);
  });
});
