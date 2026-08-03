import { describe, expect, test, vi } from "vitest";

import {
  createViewerId,
  getOrCreateViewerId,
  sendViewerHeartbeat,
  viewerIdStorageKey,
} from "./viewer-client";
import { isValidViewerId } from "./viewer-id";

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe("getOrCreateViewerId", () => {
  test("creates an opaque identifier valid for the viewer endpoint", () => {
    expect(isValidViewerId(createViewerId())).toBe(true);
  });

  test("reuses a valid stored browser identifier", () => {
    const storage = memoryStorage("viewer-existing");
    const createId = vi.fn(() => "viewer-new");

    expect(getOrCreateViewerId(storage, createId)).toBe("viewer-existing");
    expect(createId).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("replaces an invalid stored value", () => {
    const storage = memoryStorage("invalid value");

    expect(getOrCreateViewerId(storage, () => "viewer-new")).toBe("viewer-new");
    expect(storage.setItem).toHaveBeenCalledWith(viewerIdStorageKey, "viewer-new");
  });
});

describe("sendViewerHeartbeat", () => {
  test("returns the active count from the viewer endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json({ count: 3 }));

    await expect(sendViewerHeartbeat("viewer-a", fetcher)).resolves.toBe(3);
    expect(fetcher).toHaveBeenCalledWith("/api/viewers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId: "viewer-a" }),
      cache: "no-store",
    });
  });

  test("rejects an unsuccessful endpoint response", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "Unavailable" }, { status: 503 }),
    );

    await expect(sendViewerHeartbeat("viewer-a", fetcher)).rejects.toThrow(
      "Viewer heartbeat failed",
    );
  });

  test.each([{ count: -1 }, { count: 1.5 }, { count: "3" }, {}])(
    "rejects malformed count response %#",
    async (body) => {
      const fetcher = vi.fn(async () => Response.json(body));

      await expect(sendViewerHeartbeat("viewer-a", fetcher)).rejects.toThrow(
        "Invalid viewer count response",
      );
    },
  );
});
