import { describe, expect, it, vi } from "vitest";

import { createSteeringTrimPatch } from "./route";

const sessionId = "bd450fe7-ec99-4983-a5fe-46ca30f260de";

function request(body: unknown, origin = "https://rcmania.live") {
  return new Request(`https://rcmania.live/api/drive-sessions/${sessionId}/steering-trim`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("PATCH drive session steering trim", () => {
  it("persists a bounded trim for the signed-in session owner", async () => {
    const save = vi.fn(async () => true);
    const response = await createSteeringTrimPatch({
      getUserId: async () => "user-1",
      save,
      now: () => new Date("2026-08-21T12:01:00.000Z"),
    })(request({ steeringTrimPercent: -12 }), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ steeringTrimPercent: -12 });
    expect(save).toHaveBeenCalledWith(
      sessionId,
      "user-1",
      -12,
      new Date("2026-08-21T12:01:00.000Z"),
    );
  });

  it("requires authentication", async () => {
    const save = vi.fn(async () => true);
    const response = await createSteeringTrimPatch({
      getUserId: async () => null,
      save,
      now: () => new Date(),
    })(request({ steeringTrimPercent: 0 }), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([-21, 21, 2.5, "4", null])("rejects invalid trim %j", async (steeringTrimPercent) => {
    const response = await createSteeringTrimPatch({
      getUserId: async () => "user-1",
      save: vi.fn(async () => true),
      now: () => new Date(),
    })(request({ steeringTrimPercent }), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(400);
  });

  it("rejects cross-origin requests", async () => {
    const response = await createSteeringTrimPatch({
      getUserId: async () => "user-1",
      save: vi.fn(async () => true),
      now: () => new Date(),
    })(request({ steeringTrimPercent: 3 }, "https://evil.example"), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(403);
  });

  it("rejects expired or unowned sessions", async () => {
    const response = await createSteeringTrimPatch({
      getUserId: async () => "user-1",
      save: vi.fn(async () => false),
      now: () => new Date(),
    })(request({ steeringTrimPercent: 3 }), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(409);
  });
});
