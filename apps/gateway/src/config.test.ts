import { describe, expect, it } from "vitest";

import { createGatewayIceServers, loadGatewayConfig } from "./config.js";

const baseEnv = {
  GATEWAY_PUBLIC_URL: "wss://rcmania.live/gateway/v1/socket",
  DEVICE_AUTH_PEPPER: "device-auth-pepper-with-enough-entropy",
  GATEWAY_SESSION_SECRET: "gateway-session-secret-with-enough-entropy"
};

describe("gateway TURN configuration", () => {
  it("loads URL-only templates and issues session-scoped TURN credentials", () => {
    const config = loadGatewayConfig({
      ...baseEnv,
      GATEWAY_ICE_SERVERS_JSON: JSON.stringify([
        { urls: "stun:turn.rcmania.live:3478" },
        { urls: "turn:turn.rcmania.live:3478?transport=udp" },
        { urls: "turns:turn.rcmania.live:443?transport=tcp" }
      ]),
      TURN_SHARED_SECRET_FILE: "/run/secrets/turn_shared_secret",
      TURN_CREDENTIAL_TTL_SECONDS: "600"
    }, (path) => {
      expect(path).toBe("/run/secrets/turn_shared_secret");
      return "a-very-long-turn-shared-secret-value\n";
    });

    expect(config.iceServerTemplates).toHaveLength(3);
    expect(createGatewayIceServers(config, "session-123", new Date("2026-08-18T12:00:00.000Z"))).toEqual([
      { urls: "stun:turn.rcmania.live:3478" },
      {
        urls: "turn:turn.rcmania.live:3478?transport=udp",
        username: "1787055000:session-123",
        credential: "ssBXmcz/a5JLgi2edKfJFYJwRdU="
      },
      {
        urls: "turns:turn.rcmania.live:443?transport=tcp",
        username: "1787055000:session-123",
        credential: "ssBXmcz/a5JLgi2edKfJFYJwRdU="
      }
    ]);
  });

  it("keeps STUN-only development configuration working without a TURN secret", () => {
    const config = loadGatewayConfig(baseEnv, () => "unused");

    expect(createGatewayIceServers(config, "session-123", new Date())).toEqual([
      { urls: "stun:stun.l.google.com:19302" }
    ]);
  });

  it("rejects TURN without a secret file, short secrets, and static credentials", () => {
    const turnJson = JSON.stringify([{ urls: "turn:turn.rcmania.live:3478" }]);
    expect(() => loadGatewayConfig({ ...baseEnv, GATEWAY_ICE_SERVERS_JSON: turnJson }, () => "unused")).toThrow(/secret/i);
    expect(() => loadGatewayConfig({
      ...baseEnv,
      GATEWAY_ICE_SERVERS_JSON: turnJson,
      TURN_SHARED_SECRET_FILE: "secret"
    }, () => "short")).toThrow(/32/);
    expect(() => loadGatewayConfig({
      ...baseEnv,
      GATEWAY_ICE_SERVERS_JSON: JSON.stringify([{ urls: "turn:turn.rcmania.live:3478", username: "static", credential: "bad" }]),
      TURN_SHARED_SECRET_FILE: "secret"
    }, () => "a-very-long-turn-shared-secret-value")).toThrow(/static/i);
  });
});

describe("gateway viewer capacity", () => {
  it("defaults to 500 viewers and accepts a lower deployment cap", () => {
    expect(loadGatewayConfig(baseEnv, () => "unused").viewerCapacity).toBe(500);
    expect(loadGatewayConfig({
      ...baseEnv,
      GATEWAY_VIEWER_CAPACITY: "2"
    }, () => "unused").viewerCapacity).toBe(2);
  });

  it("rejects viewer capacities outside the global production bound", () => {
    expect(() => loadGatewayConfig({
      ...baseEnv,
      GATEWAY_VIEWER_CAPACITY: "0"
    }, () => "unused")).toThrow(/between 1 and 500/u);
    expect(() => loadGatewayConfig({
      ...baseEnv,
      GATEWAY_VIEWER_CAPACITY: "501"
    }, () => "unused")).toThrow(/between 1 and 500/u);
  });
});
