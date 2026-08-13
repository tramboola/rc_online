import { describe, expect, it } from "vitest";

import {
  generateOpaqueSecret,
  hashOpaqueSecret,
  signBrowserTicket,
  verifyBrowserTicket,
  verifyOpaqueSecret
} from "./index.js";

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
