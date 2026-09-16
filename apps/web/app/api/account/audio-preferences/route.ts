import { z } from "zod";

import { createPostgresAudioPreferencesStore, type AudioPreferencesStore } from "../../../audio-preferences-store";

const bodySchema = z.object({
  accountId: z.string().min(1).max(128),
  volumePercent: z.number().int().min(0).max(100),
  muted: z.boolean(),
  revision: z.number().int().min(0).max(2147483646),
}).strict();

function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

const unavailable = () => privateJson({ error: "Audio preferences unavailable" }, 503);

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 4096) throw new RangeError("Body too large");
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        try { await reader.cancel(); } catch { /* Preserve the size error. */ }
        throw new RangeError("Body too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function createAudioPreferencesRoute(dependencies: {
  canonicalOrigin: string;
  getSubject(): Promise<string | null>;
  store: AudioPreferencesStore;
}) {
  if (new URL(dependencies.canonicalOrigin).origin !== dependencies.canonicalOrigin) {
    throw new Error("Canonical origin required");
  }
  return {
    async GET(_request: Request): Promise<Response> {
      try {
        const subject = await dependencies.getSubject();
        if (!subject) return privateJson({ error: "Sign in required" }, 401);
        const preferences = await dependencies.store.get(subject);
        return preferences ? privateJson({ ...preferences, accountId: subject }) : privateJson({ error: "Account unavailable" }, 404);
      } catch { return unavailable(); }
    },
    async PATCH(request: Request): Promise<Response> {
      if (request.headers.get("origin") !== dependencies.canonicalOrigin) {
        return privateJson({ error: "Cross-origin request rejected" }, 403);
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return privateJson({ error: "JSON request required" }, 415);
      }
      try {
        const subject = await dependencies.getSubject();
        if (!subject) return privateJson({ error: "Sign in required" }, 401);
        let body: unknown;
        try { body = await readBody(request); }
        catch (error) { return privateJson({ error: "Invalid request" }, error instanceof RangeError ? 413 : 400); }
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) return privateJson({ error: "Invalid preferences" }, 400);
        if (parsed.data.accountId !== subject) return privateJson({ error: "Account changed" }, 403);
        const result = await dependencies.store.save(subject, parsed.data);
        if (!result) return privateJson({ error: "Account unavailable" }, 404);
        return privateJson({ ...result.preferences, accountId: subject }, result.saved ? 200 : 409);
      } catch { return unavailable(); }
    },
  };
}

let cachedStore: { databaseUrl: string; store: AudioPreferencesStore } | undefined;

async function productionRoute() {
  const databaseUrl = process.env.DATABASE_URL;
  const canonicalOrigin = process.env.AUTH_URL;
  if (!databaseUrl || !canonicalOrigin) throw new Error("Audio preferences unavailable");
  if (!cachedStore || cachedStore.databaseUrl !== databaseUrl) {
    cachedStore = { databaseUrl, store: createPostgresAudioPreferencesStore(databaseUrl) };
  }
  const { auth } = await import("../../../../auth");
  return createAudioPreferencesRoute({
    canonicalOrigin,
    getSubject: async () => (await auth())?.user?.id ?? null,
    store: cachedStore.store,
  });
}

export async function GET(request: Request): Promise<Response> {
  try { return await (await productionRoute()).GET(request); }
  catch { return unavailable(); }
}

export async function PATCH(request: Request): Promise<Response> {
  try { return await (await productionRoute()).PATCH(request); }
  catch { return unavailable(); }
}
