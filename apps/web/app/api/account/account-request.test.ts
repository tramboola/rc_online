import { describe, expect, test } from "vitest";
import { z } from "zod";

import { readAccountPost } from "./account-request";

const origin = "https://rcmania.live";
const schema = z.object({ value: z.string() }).strict();

function streamedRequest(chunks: Uint8Array[], contentLength?: string) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin,
    "x-real-ip": "203.0.113.24",
  };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  const request = new Request(`${origin}/api/account/register`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return {
    request,
    state: () => ({ pulls, cancelled }),
  };
}

describe("bounded account request bodies", () => {
  test("cancels immediately above 4096 bytes without consuming later chunks", async () => {
    const first = new Uint8Array(4_090).fill(0x20);
    const second = new Uint8Array(16).fill(0x20);
    const laterSecret = new TextEncoder().encode("later-secret-must-not-be-read");
    const streamed = streamedRequest([first, second, laterSecret], "12");

    const result = await readAccountPost(streamed.request, schema, origin);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(streamed.state()).toEqual({ pulls: 2, cancelled: true });
  });

  test("cancels without pulling when Content-Length already exceeds the bound", async () => {
    const streamed = streamedRequest([
      new TextEncoder().encode(JSON.stringify({ value: "must not be read" })),
    ], "4097");

    const result = await readAccountPost(streamed.request, schema, origin);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(streamed.state()).toEqual({ pulls: 0, cancelled: true });
  });

  test("accepts valid UTF-8 split across byte chunks without Content-Length", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ value: "řidič 🏁" }));
    const splitInsideUnicode = 13;
    const streamed = streamedRequest([
      encoded.slice(0, splitInsideUnicode),
      encoded.slice(splitInsideUnicode),
    ]);

    await expect(readAccountPost(streamed.request, schema, origin)).resolves.toMatchObject({
      ok: true,
      data: { value: "řidič 🏁" },
    });
  });

  test("rejects a null body, invalid UTF-8, and invalid JSON safely", async () => {
    const headers = {
      "content-type": "application/json",
      origin,
      "x-real-ip": "203.0.113.24",
    };
    const nullBody = new Request(`${origin}/api/account/register`, {
      method: "POST",
      headers,
    });
    const invalidUtf8 = streamedRequest([new Uint8Array([0xc3, 0x28])]);
    const invalidJson = streamedRequest([new TextEncoder().encode("{not-json")]);

    for (const request of [nullBody, invalidUtf8.request, invalidJson.request]) {
      const result = await readAccountPost(request, schema, origin);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(400);
    }
  });
});
