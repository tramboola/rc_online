import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";

import { GatewayClientMessageSchema, type GatewayClientMessage, type GatewayServerMessage } from "@rc/contracts";
import { generateOpaqueSecret, hashOpaqueSecret, verifyBrowserTicket } from "@rc/device-auth";

import { createGatewayIceServers, type GatewayConfig } from "./config.js";
import { PresenceRegistry } from "./presence.js";
import { SessionRegistry, type GatewayPeer } from "./sessions.js";
import type { AuthenticatedDevice, GatewayStore } from "./store.js";
import { ViewerPresence, sweepViewerPings } from "./viewer-presence.js";

const enrollmentSchema = z.object({
  enrollmentCode: z.string().min(24).max(256),
  serialNumber: z.string().min(4).max(128),
  agentVersion: z.string().min(1).max(64),
  capabilities: z.record(z.string(), z.unknown())
}).strict();

export function createGatewayServer(config: GatewayConfig, store: GatewayStore): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 64 * 1024 });
  const presence = new PresenceRegistry(store, config.staleAfterMs);
  const sessions = new SessionRegistry();
  const devices = new Map<string, WebSocket>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_100_000, perMessageDeflate: false });
  const viewerPresence = new ViewerPresence();
  const viewerSockets = new Set<WebSocket>();
  const viewerAlive = new WeakSet<WebSocket>();
  const viewers = new WebSocketServer({ noServer: true, maxPayload: 256, perMessageDeflate: false });

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
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname === "/v1/socket") {
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        sockets.emit("connection", webSocket, request);
      });
      return;
    }
    if (url.pathname === "/v1/viewers") {
      if (request.headers.origin !== config.viewerOrigin) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (viewerSockets.size >= config.viewerCapacity) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      viewers.handleUpgrade(request, socket, head, (webSocket) => {
        viewers.emit("connection", webSocket, request);
      });
      return;
    }
    socket.destroy();
  });

  sockets.on("connection", (socket) => {
    let authenticatedDevice: AuthenticatedDevice | null = null;
    let authenticatedSessionId: string | null = null;
    let closed = false;
    const peer: GatewayPeer = {
      send: (message) => send(socket, message),
      close: (code, reason) => socket.close(code, reason)
    };
    const authenticationTimeout = setTimeout(() => {
      if (!authenticatedDevice && !authenticatedSessionId) socket.close(4401, "authentication required");
    }, config.authTimeoutMs);
    authenticationTimeout.unref();

    socket.on("message", async (raw: RawData, binary: boolean) => {
      try {
        if (binary) throw new Error("Binary messages are unsupported");
        const message = GatewayClientMessageSchema.parse(JSON.parse(raw.toString()));

        if (!authenticatedDevice && !authenticatedSessionId) {
          if (message.type === "device.authenticate") {
            const suppliedHash = hashOpaqueSecret(message.secret, config.deviceAuthPepper);
            authenticatedDevice = await store.authenticateDevice(
              message.deviceId,
              suppliedHash,
              message.agentVersion,
              message.capabilities ?? {},
              new Date()
            );
            if (!authenticatedDevice) {
              send(socket, { v: 1, type: "auth.rejected", reason: "invalid device credentials" });
              socket.close(4403, "invalid credentials");
              return;
            }
            clearTimeout(authenticationTimeout);
            const prior = devices.get(authenticatedDevice.deviceId);
            if (prior && prior !== socket) prior.close(4409, "replaced by a new connection");
            devices.set(authenticatedDevice.deviceId, socket);
            sessions.attachDevice(authenticatedDevice.carId, authenticatedDevice.deviceId, peer);
            send(socket, { v: 1, type: "auth.accepted", peer: "device" });
            await offerPendingUpdate(authenticatedDevice, socket);
            return;
          }
          if (message.type === "browser.authenticate") {
            const ticket = verifyBrowserTicket(message.ticket, config.browserTicketSecret);
            const authorized = await store.authorizeDriveSession({
              sessionId: ticket.sessionId,
              userId: ticket.sub,
              carId: ticket.carId,
              now: new Date()
            });
            if (!authorized) {
              send(socket, { v: 1, type: "auth.rejected", reason: "drive session unavailable" });
              socket.close(4409, "drive session unavailable");
              return;
            }
            const attached = sessions.attachBrowser({
              sessionId: ticket.sessionId,
              userId: ticket.sub,
              carId: ticket.carId,
              expiresAt: authorized.expiresAt,
              iceServers: createGatewayIceServers(config, ticket.sessionId, new Date())
            }, peer);
            if (!attached) {
              await store.endDriveSession(ticket.sessionId, "car device unavailable", new Date());
              send(socket, { v: 1, type: "auth.rejected", reason: "drive session unavailable" });
              socket.close(4409, "drive session unavailable");
              return;
            }
            authenticatedSessionId = ticket.sessionId;
            clearTimeout(authenticationTimeout);
            send(socket, { v: 1, type: "auth.accepted", peer: "browser" });
            return;
          }
          send(socket, { v: 1, type: "auth.rejected", reason: "authentication required" });
          socket.close(4401, "authentication required");
          return;
        }

        if (authenticatedDevice && message.type === "device.heartbeat") {
          await presence.heartbeat(authenticatedDevice.deviceId, message.health);
          sessions.sendDeviceTelemetry(
            authenticatedDevice.carId,
            message.health.batteryVoltage ?? null,
            message.health.batteryPercent ?? null
          );
          await offerPendingUpdate(authenticatedDevice, socket);
          return;
        }
        if (authenticatedDevice && message.type === "device.update.status") {
          const accepted = await store.recordUpdateStatus(
            authenticatedDevice.deviceId,
            message.updateId,
            message.status,
            message.reason ?? null,
            new Date()
          );
          if (!accepted) throw new Error("Update status does not belong to this device or transition");
          return;
        }
        if (authenticatedDevice && isRelayMessage(message)) {
          if (!sessions.relayFromDevice(authenticatedDevice.carId, message)) {
            throw new Error("Message does not match the active device session");
          }
          if (message.type === "session.end") {
            await store.endDriveSession(message.sessionId, message.reason, new Date());
          }
          return;
        }
        if (authenticatedSessionId && isRelayMessage(message)) {
          if (!sessions.relayFromBrowser(authenticatedSessionId, message)) {
            throw new Error("Message does not match the active browser session");
          }
          if (message.type === "session.end") {
            await store.endDriveSession(message.sessionId, message.reason, new Date());
          }
          return;
        }
        if (authenticatedSessionId && message.type === "session.connected") {
          const now = new Date();
          const databaseMarked = message.sessionId === authenticatedSessionId
            && await store.markDriveSessionActive(authenticatedSessionId, now);
          const registryMarked = databaseMarked && sessions.markConnected(authenticatedSessionId, now);
          if (!registryMarked) {
            if (databaseMarked) {
              await store.endDriveSession(authenticatedSessionId, "connection timed out", now);
            }
            throw new Error("Drive session could not become active");
          }
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
      if (authenticatedDevice && devices.get(authenticatedDevice.deviceId) === socket) {
        devices.delete(authenticatedDevice.deviceId);
        const sessionId = sessions.detachDevice(authenticatedDevice.carId, peer);
        if (sessionId) await store.endDriveSession(sessionId, "device disconnected", new Date()).catch(() => undefined);
        await presence.disconnect(authenticatedDevice.deviceId).catch(() => undefined);
      }
      if (authenticatedSessionId) {
        sessions.detachBrowser(authenticatedSessionId, "browser disconnected");
        await store.endDriveSession(authenticatedSessionId, "browser disconnected", new Date()).catch(() => undefined);
      }
    });
    socket.on("error", () => undefined);
  });

  viewers.on("connection", (socket) => {
    viewerSockets.add(socket);
    viewerAlive.add(socket);
    const detach = viewerPresence.attach(socket);

    socket.on("message", () => {
      socket.close(4400, "viewer payload unsupported");
    });
    socket.on("pong", () => {
      viewerAlive.add(socket);
    });
    socket.on("close", () => {
      viewerSockets.delete(socket);
      viewerAlive.delete(socket);
      detach();
    });
    socket.on("error", () => undefined);
  });

  const sweepTimer = setInterval(() => {
    void presence.sweep().catch((error: unknown) => app.log.error({ err: error }, "presence sweep failed"));
    void store.expireDriveSessions(new Date()).catch((error: unknown) => app.log.error({ err: error }, "database session expiry failed"));
    for (const sessionId of sessions.sweep()) {
      void store.endDriveSession(sessionId, "session expired", new Date()).catch((error: unknown) => app.log.error({ err: error }, "session expiry failed"));
    }
  }, 5_000);
  sweepTimer.unref();

  const viewerPingTimer = setInterval(() => {
    sweepViewerPings(viewerSockets, viewerAlive);
  }, 45_000);
  viewerPingTimer.unref();

  let connectionsClosing = false;
  const closeGatewaySockets = () => {
    if (connectionsClosing) return;
    connectionsClosing = true;
    clearInterval(sweepTimer);
    clearInterval(viewerPingTimer);
    for (const socket of devices.values()) socket.close(1001, "server shutdown");
    for (const socket of viewerSockets) socket.close(1001, "server shutdown");
    sockets.close();
    viewers.close();
  };

  app.addHook("preClose", async () => {
    closeGatewaySockets();
  });
  app.addHook("onClose", async () => {
    closeGatewaySockets();
  });

  return app;

  async function offerPendingUpdate(device: AuthenticatedDevice, socket: WebSocket): Promise<void> {
    const runtimeGeneration = device.capabilities.otaRuntimeGeneration ?? null;
    if (runtimeGeneration === null || sessions.hasActiveCar(device.carId)) return;
    const offer = await store.claimPendingUpdate(device.deviceId, runtimeGeneration, new Date());
    if (offer) send(socket, { v: 1, type: "device.update.available", ...offer });
  }
}

function rejectUpgrade(
  socket: { end(data: string): unknown },
  status: number,
  reason: string
): void {
  socket.end([
    `HTTP/1.1 ${status} ${reason}`,
    "Connection: close",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"));
}

function send(socket: WebSocket, message: GatewayServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function isRelayMessage(message: GatewayClientMessage): message is Extract<GatewayClientMessage, { type: "signal.offer" | "signal.answer" | "signal.ice" | "session.end" }> {
  return message.type === "signal.offer" || message.type === "signal.answer" || message.type === "signal.ice" || message.type === "session.end";
}
