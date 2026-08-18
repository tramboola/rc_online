import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createGatewayServer } from "./server.js";
import type {
  AuthenticatedDevice,
  ConsumeEnrollmentInput,
  GatewayStore
} from "./store.js";

const servers: Array<ReturnType<typeof createGatewayServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function createStore() {
  let enrolled = false;
  let credentialHash = "";
  const heartbeats: unknown[] = [];
  const store = {
    consumeEnrollment: async (input: ConsumeEnrollmentInput) => {
      if (enrolled) return null;
      enrolled = true;
      credentialHash = input.secretHash;
      return { deviceId: "4de4ef64-5d30-41b9-996c-4f1bb734b7af", carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24" };
    },
    authenticateDevice: async (deviceId: string, suppliedHash: string) =>
      suppliedHash === credentialHash
        ? ({ deviceId, carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24" } satisfies AuthenticatedDevice)
        : null,
    recordHeartbeat: async (_deviceId: string, health: unknown) => {
      heartbeats.push(health);
      return { carId: "a98ddba0-65f2-453d-b45a-c7d094a45b24", adminBlocked: false };
    },
    setPresenceState: async () => undefined,
    markDeviceOffline: async () => undefined,
    expireStaleDevices: async () => 0
  } as unknown as GatewayStore;
  return { store, heartbeats };
}

async function listen(store: GatewayStore) {
  const server = createGatewayServer(
    {
      host: "127.0.0.1",
      port: 0,
      publicGatewayUrl: "wss://rcmania.live/gateway/v1/socket",
      deviceAuthPepper: "test-pepper-with-enough-entropy",
      browserTicketSecret: "test-browser-secret-with-enough-entropy",
      authTimeoutMs: 250,
      staleAfterMs: 15_000,
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
});
