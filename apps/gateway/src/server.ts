import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";

import { GatewayClientMessageSchema, type GatewayServerMessage } from "@rc/contracts";
import { generateOpaqueSecret, hashOpaqueSecret } from "@rc/device-auth";

import type { GatewayConfig } from "./config.js";
import { PresenceRegistry } from "./presence.js";
import type { AuthenticatedDevice, GatewayStore } from "./store.js";

const enrollmentSchema = z.object({
  enrollmentCode: z.string().min(24).max(256),
  serialNumber: z.string().min(4).max(128),
  agentVersion: z.string().min(1).max(64),
  capabilities: z.record(z.string(), z.unknown())
}).strict();

export function createGatewayServer(config: GatewayConfig, store: GatewayStore): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 64 * 1024 });
  const presence = new PresenceRegistry(store, config.staleAfterMs);
  const devices = new Map<string, WebSocket>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_100_000, perMessageDeflate: false });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const ready = await store.ready();
    if (!ready) return reply.code(503).send({ status: "not-ready" });
    return { status: "ready" };
  });

  app.post("/v1/enroll", async (request, reply) => {
    const parsed = enrollmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_enrollment_request" });

    const deviceSecret = generateOpaqueSecret();
    const now = new Date();
    const enrollment = await store.consumeEnrollment({
      tokenHash: hashOpaqueSecret(parsed.data.enrollmentCode, config.deviceAuthPepper),
      secretHash: hashOpaqueSecret(deviceSecret, config.deviceAuthPepper),
      serialNumber: parsed.data.serialNumber,
      agentVersion: parsed.data.agentVersion,
      capabilities: parsed.data.capabilities,
      now
    });
    if (!enrollment) return reply.code(409).send({ error: "enrollment_unavailable" });

    return reply.code(201).send({
      ...enrollment,
      deviceSecret,
      gatewayUrl: config.publicGatewayUrl
    });
  });

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/v1/socket") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.emit("connection", webSocket, request);
    });
  });

  sockets.on("connection", (socket) => {
    let authenticated: AuthenticatedDevice | null = null;
    let closed = false;
    const authenticationTimeout = setTimeout(() => {
      if (!authenticated) socket.close(4401, "authentication required");
    }, config.authTimeoutMs);
    authenticationTimeout.unref();

    socket.on("message", async (raw: RawData, binary: boolean) => {
      try {
        if (binary) throw new Error("Binary messages are unsupported");
        const message = GatewayClientMessageSchema.parse(JSON.parse(raw.toString()));

        if (!authenticated) {
          if (message.type !== "device.authenticate") {
            send(socket, { v: 1, type: "auth.rejected", reason: "device authentication required" });
            socket.close(4401, "authentication required");
            return;
          }
          const suppliedHash = hashOpaqueSecret(message.secret, config.deviceAuthPepper);
          authenticated = await store.authenticateDevice(message.deviceId, suppliedHash, new Date());
          if (!authenticated) {
            send(socket, { v: 1, type: "auth.rejected", reason: "invalid device credentials" });
            socket.close(4403, "invalid credentials");
            return;
          }
          clearTimeout(authenticationTimeout);
          const prior = devices.get(authenticated.deviceId);
          if (prior && prior !== socket) prior.close(4409, "replaced by a new connection");
          devices.set(authenticated.deviceId, socket);
          send(socket, { v: 1, type: "auth.accepted", peer: "device" });
          return;
        }

        if (message.type === "device.heartbeat") {
          await presence.heartbeat(authenticated.deviceId, message.health);
          return;
        }
        send(socket, { v: 1, type: "error", code: "unsupported_message", message: "Message is not valid for this connection" });
      } catch {
        send(socket, { v: 1, type: "error", code: "invalid_message", message: "Malformed or invalid gateway message" });
        socket.close(4400, "invalid message");
      }
    });

    socket.on("close", async () => {
      if (closed) return;
      closed = true;
      clearTimeout(authenticationTimeout);
      if (authenticated && devices.get(authenticated.deviceId) === socket) {
        devices.delete(authenticated.deviceId);
        await presence.disconnect(authenticated.deviceId).catch(() => undefined);
      }
    });
    socket.on("error", () => undefined);
  });

  const sweepTimer = setInterval(() => {
    void presence.sweep().catch((error: unknown) => app.log.error({ err: error }, "presence sweep failed"));
  }, 5_000);
  sweepTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(sweepTimer);
    for (const socket of devices.values()) socket.close(1001, "server shutdown");
    sockets.close();
  });

  return app;
}

function send(socket: WebSocket, message: GatewayServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
