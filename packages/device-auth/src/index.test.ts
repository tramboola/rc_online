import { describe, expect, it } from "vitest";

import {
  createSessionIceServers,
  createTurnRestCredentials,
  generateOpaqueSecret,
  hashOpaqueSecret,
  signBrowserTicket,
  verifyBrowserTicket,
  verifyOpaqueSecret
} from "./index.js";

describe("TURN REST credentials", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  const secret = "a-very-long-turn-shared-secret-value";

  it("creates the Coturn timestamp username and HMAC-SHA1 password", () => {
    expect(createTurnRestCredentials({
      secret,
      subject: "session-123",
      now,
      ttlSeconds: 600
    })).toEqual({
      username: "1787055000:session-123",
      credential: "ssBXmcz/a5JLgi2edKfJFYJwRdU=",
      expiresAt: new Date("2026-08-18T12:10:00.000Z")
    });
  });

  it("adds one temporary credential to TURN entries and leaves STUN anonymous", () => {
    expect(createSessionIceServers([
      { urls: "stun:turn.rcmania.live:3478" },
      { urls: "turn:turn.rcmania.live:3478?transport=udp" },
      { urls: ["turn:turn.rcmania.live:3478?transport=tcp", "turns:turn.rcmania.live:443?transport=tcp"] }
    ], { secret, subject: "session-123", now, ttlSeconds: 600 })).toEqual([
      { urls: "stun:turn.rcmania.live:3478" },
      {
        urls: "turn:turn.rcmania.live:3478?transport=udp",
        username: "1787055000:session-123",
        credential: "ssBXmcz/a5JLgi2edKfJFYJwRdU="
      },
      {
        urls: ["turn:turn.rcmania.live:3478?transport=tcp", "turns:turn.rcmania.live:443?transport=tcp"],
        username: "1787055000:session-123",
        credential: "ssBXmcz/a5JLgi2edKfJFYJwRdU="
      }
    ]);
  });

  it("fails closed for static TURN credentials, missing secrets, invalid subjects, and unsafe lifetimes", () => {
    const turn = [{ urls: "turn:turn.rcmania.live:3478", username: "static", credential: "password" }];

    expect(() => createSessionIceServers(turn, { secret, subject: "session-123", now })).toThrow(/static/i);
    expect(() => createSessionIceServers([{ urls: "turn:turn.rcmania.live:3478" }], { subject: "session-123", now })).toThrow(/secret/i);
    expect(() => createTurnRestCredentials({ secret, subject: "bad:subject", now })).toThrow(/subject/i);
    expect(() => createTurnRestCredentials({ secret, subject: "session-123", now, ttlSeconds: 59 })).toThrow(/60/);
    expect(() => createTurnRestCredentials({ secret, subject: "session-123", now, ttlSeconds: 3601 })).toThrow(/3600/);
  });
});

describe("opaque device secrets", () => {
  it("creates independent URL-safe secrets and verifies only the matching value", () => {
    const first = generateOpaqueSecret();
    const second = generateOpaqueSecret();
    const pepper = "server-side-pepper";
    const digest = hashOpaqueSecret(first, pepper);

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(verifyOpaqueSecret(first, digest, pepper)).toBe(true);
    expect(verifyOpaqueSecret(second, digest, pepper)).toBe(false);
    expect(verifyOpaqueSecret(first, digest, "wrong-pepper")).toBe(false);
  });
});

describe("browser gateway tickets", () => {
  const secret = "a-long-browser-ticket-secret";
  const payload = {
    aud: "rcmania-gateway" as const,
    sub: "user-1",
    role: "admin" as const,
    carId: "car-1",
    sessionId: "session-1",
    iat: 1_800_000_000,
    exp: 1_800_000_060
  };

  it("round-trips a valid short-lived ticket", () => {
    const ticket = signBrowserTicket(payload, secret);

    expect(verifyBrowserTicket(ticket, secret, 1_800_000_030)).toEqual(payload);
  });

  it("rejects tampering, the wrong secret, expiry, and future-issued tickets", () => {
    const ticket = signBrowserTicket(payload, secret);
    const [body, signature] = ticket.split(".");

    expect(() => verifyBrowserTicket(`${body}x.${signature}`, secret, 1_800_000_030)).toThrow();
    expect(() => verifyBrowserTicket(ticket, "wrong-secret", 1_800_000_030)).toThrow();
    expect(() => verifyBrowserTicket(ticket, secret, 1_800_000_061)).toThrow(/expired/i);
    expect(() => verifyBrowserTicket(ticket, secret, 1_799_999_999)).toThrow(/future/i);
  });

  it("rejects an unexpected audience even with a valid signature", () => {
    const ticket = signBrowserTicket(
      { ...payload, aud: "another-service" as "rcmania-gateway" },
      secret
    );

    expect(() => verifyBrowserTicket(ticket, secret, 1_800_000_030)).toThrow(/audience/i);
  });
});
