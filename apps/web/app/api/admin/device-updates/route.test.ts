import { describe, expect, it } from "vitest";

import { createDeviceUpdateHandlers } from "./route";

const carId = "8ae9c12e-c348-44d1-ac64-2c39cbf8a58a";
const userId = "b5c2bcad-f99a-4801-9892-d19a323fca0e";

function post(body: unknown, origin = "https://rcmania.live") {
  return new Request("https://rcmania.live/api/admin/device-updates", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("administrator device update endpoint", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const base = {
    now: () => now,
    getLatest: async () => null,
  };

  it("rejects signed-out, regular-user, cross-origin, and malformed requests", async () => {
    const requestUpdate = async () => ({ kind: "created" as const, updateId: "44444444-4444-4444-8444-444444444444" });
    expect((await createDeviceUpdateHandlers({ ...base, requestUpdate, getUser: async () => null }).POST(post({ carId, version: "0.4.1" }))).status).toBe(401);
    expect((await createDeviceUpdateHandlers({ ...base, requestUpdate, getUser: async () => ({ id: userId, role: "user" as const }) }).POST(post({ carId, version: "0.4.1" }))).status).toBe(403);
    expect((await createDeviceUpdateHandlers({ ...base, requestUpdate, getUser: async () => ({ id: userId, role: "admin" as const }) }).POST(post({ carId, version: "0.4.1" }, "https://evil.test"))).status).toBe(403);
    expect((await createDeviceUpdateHandlers({ ...base, requestUpdate, getUser: async () => ({ id: userId, role: "admin" as const }) }).POST(post({ carId, version: "latest" }))).status).toBe(400);
  });

  it("maps unavailable targets to not-found and busy cars to conflict", async () => {
    const create = (kind: "not_found" | "conflict") => createDeviceUpdateHandlers({
      ...base,
      getUser: async () => ({ id: userId, role: "admin" as const }),
      requestUpdate: async () => ({ kind }),
    });
    expect((await create("not_found").POST(post({ carId, version: "0.4.1" }))).status).toBe(404);
    expect((await create("conflict").POST(post({ carId, version: "0.4.1" }))).status).toBe(409);
  });

  it("creates one immutable update job and returns bounded status", async () => {
    const updateId = "44444444-4444-4444-8444-444444444444";
    const handlers = createDeviceUpdateHandlers({
      ...base,
      getUser: async () => ({ id: userId, role: "admin" as const }),
      requestUpdate: async (adminId, requestedCar, version, requestedAt) => {
        expect({ adminId, requestedCar, version, requestedAt }).toEqual({ adminId: userId, requestedCar: carId, version: "0.4.1", requestedAt: now });
        return { kind: "created", updateId } as const;
      },
      getLatest: async () => ({ updateId, carId, version: "0.4.1", status: "pending", failureReason: null, requestedAt: now, startedAt: null, finishedAt: null }),
    });
    expect(await (await handlers.POST(post({ carId, version: "0.4.1" }))).json()).toEqual({ updateId });
    const response = await handlers.GET(new Request(`https://rcmania.live/api/admin/device-updates?carId=${carId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updateId, version: "0.4.1", status: "pending" });
  });
});
