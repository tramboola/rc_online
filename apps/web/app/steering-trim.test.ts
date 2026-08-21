import { describe, expect, it, vi } from "vitest";

import { normalizeSteeringTrim, saveSteeringTrim } from "./steering-trim";

describe("steering trim", () => {
  it("rounds and clamps valid values", () => {
    expect(normalizeSteeringTrim(-30)).toBe(-20);
    expect(normalizeSteeringTrim(7.7)).toBe(8);
    expect(normalizeSteeringTrim(30)).toBe(20);
  });

  it("rejects non-finite values", () => {
    expect(() => normalizeSteeringTrim(Number.NaN)).toThrow();
    expect(() => normalizeSteeringTrim(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("persists the normalized value through the active session", async () => {
    const sessionId = "bd450fe7-ec99-4983-a5fe-46ca30f260de";
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ steeringTrimPercent: 12 }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await expect(saveSteeringTrim(sessionId, 11.7, fetcher)).resolves.toBe(12);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/drive-sessions/${sessionId}/steering-trim`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ steeringTrimPercent: 12 }),
      }),
    );
  });

  it("rejects unsuccessful or malformed saves", async () => {
    await expect(saveSteeringTrim("session", 0, async () => new Response(null, { status: 409 }))).rejects.toThrow();
    await expect(saveSteeringTrim("session", 0, async () => Response.json({ nope: true }))).rejects.toThrow();
  });
});
