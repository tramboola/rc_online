import { describe, expect, it } from "vitest";

import { createAudioPreferencesRoute } from "./route";
import type { StoredAudioPreferences } from "../../../ride-audio-preferences";

const url = "https://rcmania.live/api/account/audio-preferences";

function fixture() {
  let subject: string | null = "driver-one";
  const rows = new Map<string, StoredAudioPreferences>([
    ["driver-one", { volumePercent: 35, muted: false, revision: 2 }],
    ["driver-two", { volumePercent: 0, muted: true, revision: 6 }],
  ]);
  const route = createAudioPreferencesRoute({
    canonicalOrigin: "https://rcmania.live",
    getSubject: async () => subject,
    store: {
      async get(userId) { return rows.get(userId) ?? null; },
      async save(userId, value) {
        const current = rows.get(userId);
        if (!current) return null;
        if (value.revision !== current.revision) return { saved: false, preferences: current };
        const preferences = { ...value, revision: current.revision + 1 };
        rows.set(userId, preferences);
        return { saved: true, preferences };
      },
    },
  });
  return { route, rows, signIn: (id: string | null) => { subject = id; } };
}

function patch(body: object, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "PATCH",
    headers: { origin: "https://rcmania.live", "content-type": "application/json", ...headers },
    body: JSON.stringify({ accountId: "driver-one", ...body }),
  });
}

describe("account onboard audio preferences", () => {
  it("does not save an old account's pending volume after another tab changes the signed-in account", async () => {
    const { route, rows, signIn } = fixture();
    const loaded = await (await route.GET(new Request(url))).json();
    signIn("driver-two");
    rows.set("driver-two", { volumePercent: 70, muted: false, revision: 2 });
    const saved = await route.PATCH(patch({ ...loaded, volumePercent: 10 }));
    expect(saved.status).toBe(403);
    expect(rows.get("driver-two")).toEqual({ volumePercent: 70, muted: false, revision: 2 });
  });

  it("persists zero volume and mute independently for the signed-in account", async () => {
    const { route, rows, signIn } = fixture();
    const saved = await route.PATCH(patch({ volumePercent: 0, muted: false, revision: 2 }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ accountId: "driver-one", volumePercent: 0, muted: false, revision: 3 });
    const loaded = await route.GET(new Request(url));
    expect(loaded.headers.get("cache-control")).toBe("private, no-store");
    expect(await loaded.json()).toEqual({ accountId: "driver-one", volumePercent: 0, muted: false, revision: 3 });
    signIn("driver-two");
    expect(await (await route.GET(new Request(url))).json()).toEqual({ ...rows.get("driver-two"), accountId: "driver-two" });
  });

  it("rejects unauthenticated reads and writes without changing stored preferences", async () => {
    const { route, rows, signIn } = fixture();
    signIn(null);
    expect((await route.GET(new Request(url))).status).toBe(401);
    expect((await route.PATCH(patch({ volumePercent: 20, muted: false, revision: 2 }))).status).toBe(401);
    expect(rows.get("driver-one")?.volumePercent).toBe(35);
  });

  it.each([
    { volumePercent: -1, muted: false, revision: 2 },
    { volumePercent: 101, muted: false, revision: 2 },
    { volumePercent: 35.5, muted: false, revision: 2 },
    { volumePercent: "35", muted: false, revision: 2 },
    { volumePercent: 35, muted: "false", revision: 2 },
    { volumePercent: 35, muted: false, revision: -1 },
    { volumePercent: 35, muted: false, revision: 2, userId: "driver-two" },
  ])("rejects invalid preferences and arbitrary user targeting %#", async (value) => {
    const { route, rows } = fixture();
    expect((await route.PATCH(patch(value))).status).toBe(400);
    expect(rows.get("driver-one")?.revision).toBe(2);
    expect(rows.get("driver-two")?.revision).toBe(6);
  });

  it("rejects cross-origin, non-JSON and oversized updates", async () => {
    const { route } = fixture();
    const body = { volumePercent: 20, muted: true, revision: 2 };
    expect((await route.PATCH(patch(body, { origin: "https://evil.example", "x-forwarded-host": "evil.example" }))).status).toBe(403);
    expect((await route.PATCH(patch(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.PATCH(patch(body, { "content-length": "4097" }))).status).toBe(413);
    expect((await route.PATCH(patch({ ...body, extra: "x".repeat(4096) }))).status).toBe(413);
  });

  it("does not overwrite newer settings when an old request arrives last", async () => {
    const { route } = fixture();
    expect((await route.PATCH(patch({ volumePercent: 10, muted: true, revision: 2 }))).status).toBe(200);
    const stale = await route.PATCH(patch({ volumePercent: 90, muted: false, revision: 2 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ accountId: "driver-one", volumePercent: 10, muted: true, revision: 3 });
    expect(await (await route.GET(new Request(url))).json()).toEqual({ accountId: "driver-one", volumePercent: 10, muted: true, revision: 3 });
  });

  it("returns a private service failure if authentication or persistence fails", async () => {
    const route = createAudioPreferencesRoute({
      canonicalOrigin: "https://rcmania.live",
      getSubject: async () => { throw new Error("authentication unavailable"); },
      store: { get: async () => null, save: async () => null },
    });
    for (const response of [await route.GET(new Request(url)), await route.PATCH(patch({ volumePercent: 20, muted: false, revision: 0 }))]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
