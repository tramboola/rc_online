import { describe, expect, it } from "vitest";

import { verifyBrowserTicket } from "@rc/device-auth";

import { createDriveSessionPost } from "./route";

const carId = "8ae9c12e-c348-44d1-ac64-2c39cbf8a58a";
const userId = "b5c2bcad-f99a-4801-9892-d19a323fca0e";
const sessionId = "fdfe99ac-25b7-4792-ae93-e85f0e131d18";
const secret = "a-browser-ticket-secret-long-enough";

function request(origin = "https://rcmania.live") {
  return new Request("https://rcmania.live/api/admin/drive-sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ carId })
  });
}

describe("administrator drive session endpoint", () => {
  it("rejects signed-out, regular-user, and cross-origin requests", async () => {
    const createSession = async () => ({ sessionId, expiresAt: new Date("2026-08-13T10:05:00Z") });
    const base = { createSession, now: () => new Date("2026-08-13T10:00:00Z"), ticketSecret: secret, publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket", iceServers: [] };

    expect((await createDriveSessionPost({ ...base, getUser: async () => null })(request())).status).toBe(401);
    expect((await createDriveSessionPost({ ...base, getUser: async () => ({ id: userId, role: "user" as const }) })(request())).status).toBe(403);
    expect((await createDriveSessionPost({ ...base, getUser: async () => ({ id: userId, role: "admin" as const }) })(request("https://evil.example"))).status).toBe(403);
  });

  it("returns a scoped short-lived ticket for a fresh available car", async () => {
    const post = createDriveSessionPost({
      getUser: async () => ({ id: userId, role: "admin" }),
      createSession: async (requestedUser, requestedCar, now) => {
        expect({ requestedUser, requestedCar, now }).toEqual({ requestedUser: userId, requestedCar: carId, now: new Date("2026-08-13T10:00:00Z") });
        return { sessionId, expiresAt: new Date("2026-08-13T10:05:00Z") };
      },
      now: () => new Date("2026-08-13T10:00:00Z"),
      ticketSecret: secret,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const response = await post(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ sessionId, gatewayUrl: "wss://rcmania.live/gateway/v1/socket" });
    expect(verifyBrowserTicket(body.ticket, secret, 1_786_615_230)).toMatchObject({
      sub: userId,
      role: "admin",
      carId,
      sessionId
    });
  });

  it("returns conflict when the car is offline or already controlled", async () => {
    const post = createDriveSessionPost({
      getUser: async () => ({ id: userId, role: "admin" }),
      createSession: async () => null,
      now: () => new Date("2026-08-13T10:00:00Z"),
      ticketSecret: secret,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceServers: []
    });

    expect((await post(request())).status).toBe(409);
  });
});
