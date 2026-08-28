import { describe, expect, it } from "vitest";

import type { LiveQueueSnapshot } from "../../live-queue-store";
import { createQueueHandlers } from "./route";

const userId = "b5c2bcad-f99a-4801-9892-d19a323fca0e";
const now = new Date("2026-08-28T15:00:00.000Z");
const waiting: LiveQueueSnapshot = {
  entryId: "12a1a4c7-7aa5-4df9-a602-fac7858ebd79",
  position: 2,
  count: 3,
  availableCarCount: 1,
  status: "waiting",
  cars: [],
};

function request(method: "GET" | "POST" | "DELETE", origin = "https://rcmania.live") {
  return new Request("https://rcmania.live/api/queue", { method, headers: { origin } });
}

describe("live queue endpoint", () => {
  it("requires an authenticated account", async () => {
    const handlers = createQueueHandlers({
      getUser: async () => null,
      join: async () => waiting,
      read: async () => waiting,
      leave: async () => undefined,
      now: () => now,
    });

    expect((await handlers.POST(request("POST"))).status).toBe(401);
    expect((await handlers.GET(request("GET"))).status).toBe(401);
    expect((await handlers.DELETE(request("DELETE"))).status).toBe(401);
  });

  it("joins once and returns the authoritative FIFO position", async () => {
    const calls: unknown[] = [];
    const handlers = createQueueHandlers({
      getUser: async () => ({ id: userId }),
      join: async (requestedUser, at) => {
        calls.push({ requestedUser, at });
        return waiting;
      },
      read: async () => waiting,
      leave: async () => undefined,
      now: () => now,
    });

    const response = await handlers.POST(request("POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(waiting);
    expect(calls).toEqual([{ requestedUser: userId, at: now }]);
  });

  it("refreshes queue presence on reads and leaves explicitly", async () => {
    const calls: string[] = [];
    const handlers = createQueueHandlers({
      getUser: async () => ({ id: userId }),
      join: async () => waiting,
      read: async (requestedUser) => {
        calls.push(`read:${requestedUser}`);
        return waiting;
      },
      leave: async (requestedUser) => {
        calls.push(`leave:${requestedUser}`);
      },
      now: () => now,
    });

    expect((await handlers.GET(request("GET"))).status).toBe(200);
    expect((await handlers.DELETE(request("DELETE"))).status).toBe(204);
    expect(calls).toEqual([`read:${userId}`, `leave:${userId}`]);
  });

  it("rejects cross-origin queue mutations", async () => {
    const handlers = createQueueHandlers({
      getUser: async () => ({ id: userId }),
      join: async () => waiting,
      read: async () => waiting,
      leave: async () => undefined,
      now: () => now,
    });

    expect((await handlers.POST(request("POST", "https://evil.example"))).status).toBe(403);
    expect((await handlers.DELETE(request("DELETE", "https://evil.example"))).status).toBe(403);
  });

  it("accepts the canonical HTTPS origin behind the trusted reverse proxy", async () => {
    const handlers = createQueueHandlers({
      getUser: async () => ({ id: userId }),
      join: async () => waiting,
      read: async () => waiting,
      leave: async () => undefined,
      now: () => now,
    });
    const proxied = new Request("http://rcmania.live/api/queue", {
      method: "POST",
      headers: {
        origin: "https://rcmania.live",
        "x-forwarded-host": "rcmania.live",
        "x-forwarded-proto": "https",
      },
    });

    expect((await handlers.POST(proxied)).status).toBe(200);
  });
});
