import { describe, expect, it } from "vitest";

import { verifyBrowserTicket } from "@rc/device-auth";

import { createPublicIceServers, readIceTransportPolicy } from "../../../drive-session-ticket";
import { createDriveSessionPost } from "./route";

const carId = "8ae9c12e-c348-44d1-ac64-2c39cbf8a58a";
const userId = "b5c2bcad-f99a-4801-9892-d19a323fca0e";
const sessionId = "fdfe99ac-25b7-4792-ae93-e85f0e131d18";
const secret = "a-browser-ticket-secret-long-enough";

function request(
  origin = "https://rcmania.live",
  url = "https://rcmania.live/api/admin/drive-sessions",
  forwardedHeaders: HeadersInit = {}
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...forwardedHeaders },
    body: JSON.stringify({ carId })
  });
}

describe("administrator drive session endpoint", () => {
  it("rejects signed-out, regular-user, and cross-origin requests", async () => {
    const createSession = async () => ({ sessionId, expiresAt: new Date("2026-08-13T10:05:00Z"), steeringTrimPercent: 0 });
    const base = { createSession, now: () => new Date("2026-08-13T10:00:00Z"), ticketSecret: secret, publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket", createIceServers: () => [], iceTransportPolicy: "all" as const };

    expect((await createDriveSessionPost({ ...base, getUser: async () => null })(request())).status).toBe(401);
    expect((await createDriveSessionPost({ ...base, getUser: async () => ({ id: userId, role: "user" as const }) })(request())).status).toBe(403);
    expect((await createDriveSessionPost({ ...base, getUser: async () => ({ id: userId, role: "admin" as const }) })(request(
      "https://evil.example",
      "http://rcmania.live/api/admin/drive-sessions",
      { "x-forwarded-host": "rcmania.live", "x-forwarded-proto": "https" }
    ))).status).toBe(403);
  });

  it("returns a scoped short-lived ticket for a fresh available car", async () => {
    const post = createDriveSessionPost({
      getUser: async () => ({ id: userId, role: "admin" }),
      createSession: async (requestedUser, requestedCar, now) => {
        expect({ requestedUser, requestedCar, now }).toEqual({ requestedUser: userId, requestedCar: carId, now: new Date("2026-08-13T10:00:00Z") });
        return { sessionId, expiresAt: new Date("2026-08-13T10:05:00Z"), steeringTrimPercent: -7 };
      },
      now: () => new Date("2026-08-13T10:00:00Z"),
      ticketSecret: secret,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceTransportPolicy: "relay",
      createIceServers: (subject, now) => {
        expect({ subject, now }).toEqual({ subject: sessionId, now: new Date("2026-08-13T10:00:00Z") });
        return [{
          urls: "turns:turn.rcmania.live:443?transport=tcp",
          username: "1786615800:fdfe99ac-25b7-4792-ae93-e85f0e131d18",
          credential: "temporary-password"
        }];
      }
    });

    const response = await post(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      sessionId,
      expiresAt: "2026-08-13T10:05:00.000Z",
      steeringTrimPercent: -7,
      gatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceTransportPolicy: "relay",
    });
    expect(body.iceServers).toEqual([expect.objectContaining({ username: expect.stringContaining(sessionId) })]);
    expect(verifyBrowserTicket(body.ticket, secret, 1_786_615_230)).toMatchObject({
      sub: userId,
      role: "admin",
      carId,
      sessionId
    });
  });

  it("accepts the public HTTPS origin behind the trusted reverse proxy", async () => {
    const post = createDriveSessionPost({
      getUser: async () => ({ id: userId, role: "admin" }),
      createSession: async () => ({ sessionId, expiresAt: new Date("2026-08-13T10:05:00Z"), steeringTrimPercent: 0 }),
      now: () => new Date("2026-08-13T10:00:00Z"),
      ticketSecret: secret,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceTransportPolicy: "all",
      createIceServers: () => []
    });

    const response = await post(request(
      "https://rcmania.live",
      "http://rcmania.live/api/admin/drive-sessions",
      { "x-forwarded-host": "rcmania.live", "x-forwarded-proto": "https" }
    ));

    expect(response.status).toBe(201);
  });

  it("returns conflict when the car is offline or already controlled", async () => {
    const post = createDriveSessionPost({
      getUser: async () => ({ id: userId, role: "admin" }),
      createSession: async () => null,
      now: () => new Date("2026-08-13T10:00:00Z"),
      ticketSecret: secret,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      iceTransportPolicy: "all",
      createIceServers: () => []
    });

    expect((await post(request())).status).toBe(409);
  });

  it("reads URL-only ICE templates and issues a temporary TURN credential from a secret file", () => {
    const readFile = (path: string) => {
      expect(path).toBe("C:/run/secrets/turn_shared_secret");
      return "a-very-long-turn-shared-secret-value\n";
    };
    const iceServers = createPublicIceServers(sessionId, new Date("2026-08-18T12:00:00.000Z"), {
      GATEWAY_ICE_SERVERS_JSON: JSON.stringify([
        { urls: "stun:turn.rcmania.live:3478" },
        { urls: "turn:turn.rcmania.live:3478?transport=udp" }
      ]),
      TURN_SHARED_SECRET_FILE: "C:/run/secrets/turn_shared_secret",
      TURN_CREDENTIAL_TTL_SECONDS: "600"
    }, readFile);

    expect(iceServers[0]).toEqual({ urls: "stun:turn.rcmania.live:3478" });
    expect(iceServers[1]).toMatchObject({
      username: `1787055000:${sessionId}`,
      credential: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/u)
    });
  });

  it("fails closed when TURN has no secret file, a short secret, or static credentials", () => {
    const turnJson = JSON.stringify([{ urls: "turn:turn.rcmania.live:3478" }]);
    expect(() => createPublicIceServers(sessionId, new Date(), { GATEWAY_ICE_SERVERS_JSON: turnJson }, () => "unused")).toThrow(/secret/i);
    expect(() => createPublicIceServers(sessionId, new Date(), {
      GATEWAY_ICE_SERVERS_JSON: turnJson,
      TURN_SHARED_SECRET_FILE: "secret"
    }, () => "short")).toThrow(/32/);
    expect(() => createPublicIceServers(sessionId, new Date(), {
      GATEWAY_ICE_SERVERS_JSON: JSON.stringify([{ urls: "turn:turn.rcmania.live:3478", username: "static", credential: "bad" }]),
      TURN_SHARED_SECRET_FILE: "secret"
    }, () => "a-very-long-turn-shared-secret-value")).toThrow(/static/i);
  });

  it("accepts only all or relay as an ICE transport policy", () => {
    expect(readIceTransportPolicy({})).toBe("all");
    expect(readIceTransportPolicy({ WEBRTC_ICE_TRANSPORT_POLICY: "relay" })).toBe("relay");
    expect(() => readIceTransportPolicy({ WEBRTC_ICE_TRANSPORT_POLICY: "none" })).toThrow(/policy/i);
  });
});
