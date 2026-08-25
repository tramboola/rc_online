import { type IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { signBrowserTicket } from "@rc/device-auth";

import { createGatewayServer } from "./server.js";
import type {
  AuthenticatedDevice,
  ConsumeEnrollmentInput,
  GatewayStore
} from "./store.js";

const servers: Array<ReturnType<typeof createGatewayServer>> = [];
const viewerOrigin = "https://rcmania.live";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function createStore({ deferNextHeartbeat = false }: { deferNextHeartbeat?: boolean } = {}) {
  let enrolled = false;
  let credentialHash = "";
  const heartbeats: unknown[] = [];
  const claimedUpdates: string[] = [];
  const updateStatuses: unknown[] = [];
  let resolveDeferredHeartbeatStarted: (() => void) | null = null;
  const deferredHeartbeatStarted = new Promise<void>((resolve) => {
    resolveDeferredHeartbeatStarted = resolve;
  });
  let releaseDeferredHeartbeat: (() => void) | null = null;
  let pendingOffer: {
    updateId: string;
    version: string;
    runtimeGeneration: number;
    artifactUrl: string;
    artifactSizeBytes: number;
    digestSha256: string;
    signature: string;
  } | null = null;
  const store = {
    consumeEnrollment: async (input: ConsumeEnrollmentInput) => {
      if (enrolled) return null;
      enrolled = true;
      credentialHash = input.secretHash;
      return { deviceId: "4de4ef64-5d30-41b9-996c-4f1bb734b7af", carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24" };
    },
    authenticateDevice: async (deviceId: string, suppliedHash: string, agentVersion: string, capabilities: Record<string, unknown>) =>
      suppliedHash === credentialHash
        ? ({ deviceId, carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24", agentVersion, capabilities } satisfies AuthenticatedDevice)
        : null,
    claimPendingUpdate: async (deviceId: string) => {
      claimedUpdates.push(deviceId);
      const offer = pendingOffer;
      pendingOffer = null;
      return offer;
    },
    recordUpdateStatus: async (_deviceId: string, updateId: string, status: string, reason: string | null) => {
      updateStatuses.push({ updateId, status, reason });
      return true;
    },
    recordHeartbeat: async (_deviceId: string, health: unknown) => {
      if (deferNextHeartbeat) {
        deferNextHeartbeat = false;
        resolveDeferredHeartbeatStarted?.();
        await new Promise<void>((resolve) => {
          releaseDeferredHeartbeat = resolve;
        });
      }
      heartbeats.push(health);
      return { carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24", adminBlocked: false };
    },
    authorizeDriveSession: async () => ({ expiresAt: new Date("2026-08-25T19:00:00Z") }),
    endDriveSession: async () => undefined,
    setPresenceState: async () => undefined,
    markDeviceOffline: async () => undefined,
    expireStaleDevices: async () => 0
  } as unknown as GatewayStore;
  return {
    store,
    heartbeats,
    claimedUpdates,
    updateStatuses,
    waitForDeferredHeartbeat: () => deferredHeartbeatStarted,
    releaseDeferredHeartbeat() {
      if (!releaseDeferredHeartbeat) throw new Error("No heartbeat persistence is waiting");
      releaseDeferredHeartbeat();
      releaseDeferredHeartbeat = null;
    },
    setPendingOffer(offer: NonNullable<typeof pendingOffer>) { pendingOffer = offer; }
  };
}

async function listen(store: GatewayStore, viewerCapacity = 500) {
  const server = createGatewayServer(
    {
      host: "127.0.0.1",
      port: 0,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      deviceAuthPepper: "test-pepper-with-enough-entropy",
      browserTicketSecret: "test-browser-secret-with-enough-entropy",
      authTimeoutMs: 250,
      staleAfterMs: 15_000,
      viewerCapacity,
      viewerOrigin,
      iceServerTemplates: [],
      turnSharedSecret: undefined,
      turnCredentialTtlSeconds: 600
    },
    store
  );
  servers.push(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

function nextMessageOfType(socket: WebSocket, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Expected ${type} before timeout`));
    }, 1_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function expectNoMessageOfType(socket: WebSocket, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      reject(new Error(`Received ${type} before heartbeat persistence completed`));
    };
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, 50);
    socket.on("message", onMessage);
  });
}

async function openSocket(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("close", resolve);
    socket.once("error", reject);
  });
}

function viewerSocket(baseUrl: string): WebSocket {
  return new WebSocket(baseUrl.replace("http", "ws") + "/v1/viewers", {
    origin: viewerOrigin
  });
}

function rejectedUpgradeStatus(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode === undefined) {
        reject(new Error("Rejected viewer response omitted its status"));
        return;
      }
      resolve(response.statusCode);
    });
    socket.once("open", () => reject(new Error("Rejected viewer unexpectedly opened")));
    socket.once("error", reject);
  });
}

describe("gateway enrollment and device socket", () => {
  it("exchanges a one-time enrollment code for a secret exactly once", async () => {
    const { store } = createStore();
    const { server } = await listen(store);
    const body = {
      enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
      serialNumber: "10000000abc12345",
      agentVersion: "0.1.0",
      capabilities: { camera: "imx708", gpio: "direct" }
    };

    const first = await server.inject({ method: "POST", url: "/v1/enroll", payload: body });
    const second = await server.inject({ method: "POST", url: "/v1/enroll", payload: body });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      deviceId: "4de4ef64-5d30-41b9-996c-4f1bb734b7af",
      carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24",
      gatewayUrl: "wss://rcmania.live/gateway/v1/socket"
    });
    expect(first.json().deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.statusCode).toBe(409);
  });

  it("authenticates a device and accepts a bounded health heartbeat", async () => {
    const { store, heartbeats } = createStore();
    const { server, baseUrl } = await listen(store);
    const enrollment = await server.inject({
      method: "POST",
      url: "/v1/enroll",
      payload: {
        enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
        serialNumber: "10000000abc12345",
        agentVersion: "0.1.0",
        capabilities: {}
      }
    });
    const credentials = enrollment.json();
    const socket = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");

    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: 1,
      type: "device.authenticate",
      deviceId: credentials.deviceId,
      secret: credentials.deviceSecret,
      agentVersion: "0.1.0"
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.send(JSON.stringify({
      v: 1,
      type: "device.heartbeat",
      health: {
        cameraReady: true,
        gpioReady: true,
        watchdogReady: true,
        width: 1280,
        height: 720,
        fps: 60,
        cpuTemperatureC: 44,
        wifiSignalDbm: -50
      }
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(messages).toContainEqual({ v: 1, type: "auth.accepted", peer: "device" });
    expect(heartbeats).toHaveLength(1);
    socket.close();
  });

  it("sends persisted heartbeat telemetry only to its authenticated browser", async () => {
    const fixture = createStore({ deferNextHeartbeat: true });
    const { store, heartbeats } = fixture;
    const { server, baseUrl } = await listen(store);
    const enrollment = await server.inject({
      method: "POST",
      url: "/v1/enroll",
      payload: {
        enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
        serialNumber: "10000000abc12345",
        agentVersion: "0.1.0",
        capabilities: {}
      }
    });
    const credentials = enrollment.json();
    const device = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
    let browser: WebSocket | null = null;
    try {
      await openSocket(device);
      const deviceAccepted = nextMessage(device);
      device.send(JSON.stringify({
        v: 1,
        type: "device.authenticate",
        deviceId: credentials.deviceId,
        secret: credentials.deviceSecret,
        agentVersion: "0.1.0"
      }));
      expect(await deviceAccepted).toEqual({ v: 1, type: "auth.accepted", peer: "device" });

      browser = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
      const sessionStarted = nextMessageOfType(browser, "session.start");
      await openSocket(browser);
      browser.send(JSON.stringify({
        v: 1,
        type: "browser.authenticate",
        ticket: signBrowserTicket({
          aud: "rcmania-gateway",
          sub: "79c2b116-d739-413d-99fb-da59f577f88b",
          role: "admin",
          carId: credentials.carId,
          sessionId: "47b691ed-0b69-4bdb-8040-6740560596c2",
          iat: Math.floor(Date.now() / 1_000) - 1,
          exp: Math.floor(Date.now() / 1_000) + 60
        }, "test-browser-secret-with-enough-entropy")
      }));
      await sessionStarted;
      const telemetry = nextMessageOfType(browser, "device.telemetry");

      device.send(JSON.stringify({
        v: 1,
        type: "device.heartbeat",
        health: {
          cameraReady: true,
          gpioReady: true,
          watchdogReady: true,
          width: 1280,
          height: 720,
          fps: 60,
          cpuTemperatureC: 44,
          wifiSignalDbm: -50,
          batteryVoltage: 8.279,
          batteryPercent: 94
        }
      }));

      await fixture.waitForDeferredHeartbeat();
      expect(heartbeats).toHaveLength(0);
      await expectNoMessageOfType(browser, "device.telemetry");
      fixture.releaseDeferredHeartbeat();

      expect(await telemetry).toEqual({
        v: 1,
        type: "device.telemetry",
        sessionId: "47b691ed-0b69-4bdb-8040-6740560596c2",
        batteryVoltage: 8.279,
        batteryPercent: 94
      });
      expect(heartbeats).toHaveLength(1);

      const normalizedTelemetry = nextMessageOfType(browser, "device.telemetry");
      device.send(JSON.stringify({
        v: 1,
        type: "device.heartbeat",
        health: {
          cameraReady: true,
          gpioReady: true,
          watchdogReady: true,
          width: 1280,
          height: 720,
          fps: 60,
          cpuTemperatureC: 44,
          wifiSignalDbm: -50
        }
      }));
      expect(await normalizedTelemetry).toEqual({
        v: 1,
        type: "device.telemetry",
        sessionId: "47b691ed-0b69-4bdb-8040-6740560596c2",
        batteryVoltage: null,
        batteryPercent: null
      });
    } finally {
      device.terminate();
      browser?.terminate();
    }
  });

  it("closes a socket that does not authenticate promptly", async () => {
    const { store } = createStore();
    const { baseUrl } = await listen(store);
    const socket = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
    const closeCode = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });

    expect(closeCode).toBe(4401);
  });

  it("offers one pending update only to an idle OTA-capable device", async () => {
    const fixture = createStore();
    fixture.setPendingOffer({
      updateId: "44444444-4444-4444-8444-444444444444",
      version: "0.4.0",
      runtimeGeneration: 1,
      artifactUrl: "https://rcmania.live/agent-releases/rc-pi-agent-0.4.0.pyz",
      artifactSizeBytes: 1024,
      digestSha256: "a".repeat(64),
      signature: "b".repeat(86)
    });
    const { server, baseUrl } = await listen(fixture.store);
    const enrollment = await server.inject({
      method: "POST", url: "/v1/enroll", payload: {
        enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
        serialNumber: "10000000abc12345", agentVersion: "0.4.0", capabilities: {}
      }
    });
    const credentials = enrollment.json();
    const socket = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.send(JSON.stringify({
      v: 1, type: "device.authenticate", deviceId: credentials.deviceId,
      secret: credentials.deviceSecret, agentVersion: "0.4.0",
      capabilities: { controlProtocolVersion: 4, otaRuntimeGeneration: 1 }
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.claimedUpdates).toEqual([credentials.deviceId]);
    expect(messages).toContainEqual(expect.objectContaining({
      type: "device.update.available", version: "0.4.0"
    }));
    socket.close();
  });

  it("records update progress only for the authenticated device", async () => {
    const fixture = createStore();
    const { server, baseUrl } = await listen(fixture.store);
    const enrollment = await server.inject({
      method: "POST", url: "/v1/enroll", payload: {
        enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
        serialNumber: "10000000abc12345", agentVersion: "0.4.0", capabilities: {}
      }
    });
    const credentials = enrollment.json();
    const socket = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.send(JSON.stringify({
      v: 1, type: "device.authenticate", deviceId: credentials.deviceId,
      secret: credentials.deviceSecret, agentVersion: "0.4.0",
      capabilities: { otaRuntimeGeneration: 1 }
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.send(JSON.stringify({
      v: 1, type: "device.update.status", updateId: "44444444-4444-4444-8444-444444444444",
      status: "applying"
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fixture.updateStatuses).toEqual([{ updateId: "44444444-4444-4444-8444-444444444444", status: "applying", reason: null }]);
    socket.close();
  });
});

describe("anonymous viewer socket", () => {
  it("accepts the configured canonical origin and broadcasts the live count", async () => {
    const { store } = createStore();
    const { baseUrl } = await listen(store);
    const first = viewerSocket(baseUrl);
    const firstInitial = nextMessage(first);
    await openSocket(first);

    expect(await firstInitial).toEqual({ v: 1, type: "viewer.count", count: 1 });

    const firstUpdate = nextMessage(first);
    const second = viewerSocket(baseUrl);
    const secondInitial = nextMessage(second);
    await openSocket(second);

    expect(await firstUpdate).toEqual({ v: 1, type: "viewer.count", count: 2 });
    expect(await secondInitial).toEqual({ v: 1, type: "viewer.count", count: 2 });

    const firstReduced = nextMessage(first);
    second.close();
    await waitForClose(second);

    expect(await firstReduced).toEqual({ v: 1, type: "viewer.count", count: 1 });
    first.close();
  });

  it("rejects foreign and missing origins before either can consume viewer capacity", async () => {
    const { store } = createStore();
    const { baseUrl } = await listen(store, 1);
    const viewerUrl = baseUrl.replace("http", "ws") + "/v1/viewers";
    const foreign = new WebSocket(viewerUrl, { origin: "https://evil.example" });
    const foreignStatus = rejectedUpgradeStatus(foreign);
    const missing = new WebSocket(viewerUrl);
    const missingStatus = rejectedUpgradeStatus(missing);

    expect(await Promise.all([foreignStatus, missingStatus])).toEqual([403, 403]);

    const allowed = viewerSocket(baseUrl);
    const initial = nextMessage(allowed);
    await openSocket(allowed);
    expect(await initial).toEqual({ v: 1, type: "viewer.count", count: 1 });
    allowed.close();
  });

  it.each([
    ["text", () => "not an application protocol"],
    ["binary", () => Buffer.from([1, 2, 3])]
  ])("closes a viewer that sends a %s application payload", async (_kind, payload) => {
    const { store } = createStore();
    const { baseUrl } = await listen(store);
    const socket = viewerSocket(baseUrl);
    const initial = nextMessage(socket);
    await openSocket(socket);
    await initial;

    const closed = waitForClose(socket);
    socket.send(payload());

    expect(await closed).toBe(4400);
  });

  it("closes viewers during gateway shutdown", async () => {
    const { store } = createStore();
    const { server, baseUrl } = await listen(store);
    const socket = viewerSocket(baseUrl);
    const initial = nextMessage(socket);
    await openSocket(socket);
    await initial;

    const closed = waitForClose(socket);
    await server.close();

    expect(await closed).toBe(1001);
  });

  it("rejects viewers above the global cap while keeping the authenticated socket route reachable", async () => {
    const { store } = createStore();
    const { server, baseUrl } = await listen(store, 2);
    const first = viewerSocket(baseUrl);
    const second = viewerSocket(baseUrl);
    await Promise.all([openSocket(first), openSocket(second)]);

    const excess = viewerSocket(baseUrl);
    const excessStatus = await new Promise<number>((resolve, reject) => {
      excess.once("unexpected-response", (_request, response) => {
        response.resume();
        if (response.statusCode === undefined) {
          reject(new Error("Excess viewer response omitted its status"));
          return;
        }
        resolve(response.statusCode);
      });
      excess.once("open", () => reject(new Error("Excess viewer unexpectedly opened")));
      excess.once("error", reject);
    });

    const enrollment = await server.inject({
      method: "POST",
      url: "/v1/enroll",
      payload: {
        enrollmentCode: "enr_this-code-is-long-enough-for-a-test",
        serialNumber: "10000000abc12345",
        agentVersion: "0.1.0",
        capabilities: {}
      }
    });
    const credentials = enrollment.json();
    const drive = new WebSocket(baseUrl.replace("http", "ws") + "/v1/socket");
    const accepted = nextMessage(drive);
    await openSocket(drive);
    drive.send(JSON.stringify({
      v: 1,
      type: "device.authenticate",
      deviceId: credentials.deviceId,
      secret: credentials.deviceSecret,
      agentVersion: "0.1.0"
    }));

    expect(excessStatus).toBe(503);
    expect(await accepted).toEqual({ v: 1, type: "auth.accepted", peer: "device" });
    first.close();
    second.close();
    drive.close();
  });

  it("destroys malformed upgrade requests instead of throwing from URL parsing", async () => {
    const { store } = createStore();
    const { server } = await listen(store);
    const socket = new Socket();
    const destroy = vi.spyOn(socket, "destroy");
    const request = {
      url: "http://[",
      headers: { host: "localhost" }
    } as IncomingMessage;

    expect(() => server.server.emit("upgrade", request, socket, Buffer.alloc(0))).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
