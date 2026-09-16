import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RideAudioPreferences, type AudioPreferences, type StoredAudioPreferences } from "./ride-audio-preferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const response = (value: StoredAudioPreferences, status = 200) => Response.json({ accountId: "driver-one", ...value }, { status });
const stored = { volumePercent: 25, muted: false, revision: 2 };

describe("account audio preference synchronization", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls browser fetch without binding it to the preference controller", async () => {
    const browserFetch: typeof fetch = async function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return response(stored);
    };
    const preferences = new RideAudioPreferences(() => {}, browserFetch);
    await preferences.load();
    expect(preferences.value).toEqual({ volume: 0.25, muted: false });
    preferences.close();
  });

  it("uses the first-party ride audio endpoint for both reads and writes", async () => {
    const requests: string[] = [];
    const preferences = new RideAudioPreferences(() => {}, async (url, init) => {
      requests.push(String(url));
      return response(init?.body ? { volumePercent: 20, muted: false, revision: 3 } : stored);
    });
    await preferences.load();
    preferences.update({ volume: 0.2, muted: false });
    await vi.advanceTimersByTimeAsync(350);
    expect(requests).toEqual(["/api/ride-audio", "/api/ride-audio"]);
    preferences.close();
  });

  it("bounds the entire load including a response body that stalls after headers", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    const preferences = new RideAudioPreferences(() => {}, async () => new Response(stream));
    let completed = false;
    void preferences.load().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(4100);
    try {
      expect(completed).toBe(true);
      expect(preferences.value).toEqual({ volume: 0, muted: true });
    } finally {
      body.close();
      preferences.close();
    }
  });

  it("starts silent and applies the stored volume before enabling sound", async () => {
    const pending = deferred<Response>();
    const states: Array<{ volume: number; muted: boolean }> = [];
    const preferences = new RideAudioPreferences((value) => states.push(value), () => pending.promise);
    const load = preferences.load();
    expect(preferences.value).toEqual({ volume: 0, muted: true });
    pending.resolve(response(stored));
    await load;
    expect(preferences.value).toEqual({ volume: 0.25, muted: false });
    expect(states.at(-1)).toEqual({ volume: 0.25, muted: false });
    preferences.close();
  });

  it("preserves a manual volume change when the initial account load arrives late", async () => {
    const pending = deferred<Response>();
    const saved: unknown[] = [];
    const preferences = new RideAudioPreferences(() => {}, async (_input, init) => {
      if (!init?.body) return pending.promise;
      saved.push(JSON.parse(String(init.body)));
      return response({ volumePercent: 10, muted: false, revision: 3 });
    });
    const load = preferences.load();
    preferences.update({ volume: 0.1, muted: false });
    pending.resolve(response(stored));
    await load;
    await vi.advanceTimersByTimeAsync(350);
    expect(preferences.value).toEqual({ volume: 0.1, muted: false });
    expect(saved).toEqual([{ accountId: "driver-one", volumePercent: 10, muted: false, revision: 2 }]);
    preferences.close();
  });

  it("serializes writes and saves the newest value after an earlier request completes", async () => {
    const first = deferred<Response>();
    const writes: AudioPreferences[] = [];
    const preferences = new RideAudioPreferences(() => {}, async (_input, init) => {
      if (!init?.body) return response(stored);
      const body = JSON.parse(String(init.body)) as AudioPreferences;
      writes.push(body);
      return writes.length === 1 ? first.promise : response({ ...body, revision: body.revision + 1 });
    });
    await preferences.load();
    preferences.update({ volume: 0.5, muted: false });
    await vi.advanceTimersByTimeAsync(350);
    preferences.update({ volume: 0.15, muted: true });
    await vi.advanceTimersByTimeAsync(350);
    expect(writes).toEqual([{ accountId: "driver-one", volumePercent: 50, muted: false, revision: 2 }]);
    first.resolve(response({ volumePercent: 50, muted: false, revision: 3 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([
      { accountId: "driver-one", volumePercent: 50, muted: false, revision: 2 },
      { accountId: "driver-one", volumePercent: 15, muted: true, revision: 3 },
    ]);
    expect(preferences.value).toEqual({ volume: 0.15, muted: true });
    preferences.close();
  });

  it("recovers a revision conflict without applying the other tab's volume to playback", async () => {
    const writes: AudioPreferences[] = [];
    const preferences = new RideAudioPreferences(() => {}, async (_input, init) => {
      if (!init?.body) return response(stored);
      const body = JSON.parse(String(init.body)) as AudioPreferences;
      writes.push(body);
      return writes.length === 1
        ? response({ volumePercent: 90, muted: false, revision: 3 }, 409)
        : response({ ...body, revision: 4 });
    });
    await preferences.load();
    preferences.update({ volume: 0, muted: true });
    await vi.advanceTimersByTimeAsync(350);
    expect(writes).toEqual([
      { accountId: "driver-one", volumePercent: 0, muted: true, revision: 2 },
      { accountId: "driver-one", volumePercent: 0, muted: true, revision: 3 },
    ]);
    expect(preferences.value).toEqual({ volume: 0, muted: true });
    preferences.close();
  });

  it("keeps sound off when settings cannot load and lets a user enable it immediately", async () => {
    const preferences = new RideAudioPreferences(() => {}, async () => { throw new Error("offline"); });
    await preferences.load();
    expect(preferences.value).toEqual({ volume: 0, muted: true });
    preferences.update({ volume: 0.4, muted: false });
    expect(preferences.value).toEqual({ volume: 0.4, muted: false });
    preferences.close();
  });

  it("bounds a stalled initial fetch and ignores its late response", async () => {
    const pending = deferred<Response>();
    const preferences = new RideAudioPreferences(() => {}, () => pending.promise);
    const load = preferences.load();
    await vi.advanceTimersByTimeAsync(5000);
    await load;
    preferences.update({ volume: 0.2, muted: true });
    pending.resolve(response(stored));
    await vi.advanceTimersByTimeAsync(1);
    expect(preferences.value).toEqual({ volume: 0.2, muted: true });
    preferences.close();
  });

  it("flushes the final slider value on leaving a ride and does not publish after close", async () => {
    const states: unknown[] = [];
    const writes: AudioPreferences[] = [];
    const preferences = new RideAudioPreferences((value) => states.push(value), async (_input, init) => {
      if (!init?.body) return response(stored);
      const body = JSON.parse(String(init.body)) as AudioPreferences;
      writes.push(body);
      expect(init.keepalive).toBe(true);
      return response({ ...body, revision: 3 });
    });
    await preferences.load();
    preferences.update({ volume: 0.17, muted: false });
    const count = states.length;
    preferences.close();
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ accountId: "driver-one", volumePercent: 17, muted: false, revision: 2 }]);
    expect(states).toHaveLength(count);
  });
});
