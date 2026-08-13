import { describe, expect, it } from "vitest";

import type { GatewayServerMessage } from "@rc/contracts";

import { SessionRegistry, type GatewayPeer } from "./sessions.js";

function peer() {
  const messages: GatewayServerMessage[] = [];
  const value: GatewayPeer = {
    send(message) {
      messages.push(message);
    },
    close() {}
  };
  return { value, messages };
}

const session = {
  sessionId: "47b691ed-0b69-4bdb-8040-6740560596c2",
  carId: "2236bc50-658f-4c88-b786-f1b2915040a9",
  userId: "79c2b116-d739-413d-99fb-da59f577f88b",
  expiresAt: new Date("2026-08-13T10:05:00Z"),
  iceServers: []
};

describe("SessionRegistry", () => {
  it("pairs one browser with the device for exactly the ticket car", () => {
    const registry = new SessionRegistry();
    const device = peer();
    const browser = peer();
    registry.attachDevice(session.carId, "device-1", device.value);

    expect(registry.attachBrowser(session, browser.value)).toBe(true);
    expect(device.messages).toContainEqual(expect.objectContaining({
      type: "session.start",
      sessionId: session.sessionId,
      carId: session.carId
    }));
    expect(browser.messages).toContainEqual(expect.objectContaining({ type: "session.start" }));
  });

  it("rejects a second browser and a session whose car has no connected device", () => {
    const registry = new SessionRegistry();
    registry.attachDevice(session.carId, "device-1", peer().value);

    expect(registry.attachBrowser(session, peer().value)).toBe(true);
    expect(registry.attachBrowser({ ...session, sessionId: "838b5dd2-36ad-43e2-829f-f037e75207ba" }, peer().value)).toBe(false);
    expect(registry.attachBrowser({ ...session, carId: "605594be-e4d5-468c-a2c1-20f3db29f4d7" }, peer().value)).toBe(false);
  });

  it("relays only messages scoped to the paired session", () => {
    const registry = new SessionRegistry();
    const device = peer();
    const browser = peer();
    registry.attachDevice(session.carId, "device-1", device.value);
    registry.attachBrowser(session, browser.value);
    const valid = {
      v: 1 as const,
      type: "signal.offer" as const,
      sessionId: session.sessionId,
      sdp: "v=0"
    };

    expect(registry.relayFromBrowser(session.sessionId, valid)).toBe(true);
    expect(registry.relayFromBrowser(session.sessionId, { ...valid, sessionId: "da78d433-2b04-4c18-ac4c-4f779ba1f974" })).toBe(false);
    expect(device.messages).toContainEqual(valid);
  });

  it("ends the device session immediately when the browser disconnects", () => {
    const registry = new SessionRegistry();
    const device = peer();
    const browser = peer();
    registry.attachDevice(session.carId, "device-1", device.value);
    registry.attachBrowser(session, browser.value);

    registry.detachBrowser(session.sessionId, "browser disconnected");

    expect(device.messages).toContainEqual({
      v: 1,
      type: "session.end",
      sessionId: session.sessionId,
      reason: "browser disconnected"
    });
  });
});
