import { mkdirSync } from "node:fs";
import path from "node:path";

import { parseRuntimeEnvironment } from "@rc/config";
import Fastify from "fastify";

import { EdgeOutbox } from "./outbox.js";
import { EdgeSafetyGate } from "./safety.js";

const environment = parseRuntimeEnvironment();
const databasePath = process.env.EDGE_DATABASE_PATH ?? "./data/edge-outbox.db";
mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

const outbox = new EdgeOutbox(databasePath, "edge-prague-neon");
const safety = new EdgeSafetyGate();
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  genReqId: (request) =>
    typeof request.headers["x-correlation-id"] === "string"
      ? request.headers["x-correlation-id"]
      : crypto.randomUUID(),
});

app.get("/health/live", async () => ({
  status: "ok",
  monotonicNs: process.hrtime.bigint().toString(),
}));

app.get("/health/ready", async () => ({
  status: "ready",
  checks: { sqliteOutbox: true, cloudConfigured: Boolean(environment.databaseUrl) },
  pendingEvents: outbox.pending().length,
}));

app.post<{ Body: { rideId: string } }>("/v1/edge/rides/activate", async (request) => {
  safety.activateRide(request.body.rideId);
  const event = outbox.append(
    "edge.ride.activated",
    { rideId: request.body.rideId },
    `ride:${request.body.rideId}:activated`,
  );
  return { status: "active", event };
});

app.post<{
  Body: {
    rideId: string;
    sequence: number;
    steering: number;
    throttle: number;
    brake: number;
    receivedMonotonicMs: number;
  };
}>("/v1/edge/control", async (request) => {
  const decision = safety.apply(
    request.body,
    Number(process.hrtime.bigint() / 1_000_000n),
  );
  if (!decision.accepted) {
    outbox.append(
      "edge.control.rejected",
      { rideId: request.body.rideId, reason: decision.reason },
      `control:${request.body.rideId}:${request.body.sequence}:${decision.reason}`,
    );
  }
  return decision;
});

app.post<{ Body: { reason: string; actorId: string } }>(
  "/v1/operator/stop-all",
  async (request) => {
    const decision = safety.stop(request.body.reason);
    const event = outbox.append(
      "operator.stop_all",
      {
        actorId: request.body.actorId,
        reason: request.body.reason,
        decision,
      },
      `operator-stop:${crypto.randomUUID()}`,
    );
    return { status: "stopped", decision, event };
  },
);

app.get("/v1/edge/outbox", async () => ({ events: outbox.pending() }));

app.addHook("onClose", async () => {
  outbox.close();
});

await app.listen({
  port: Number(process.env.EDGE_PORT ?? 3002),
  host: "0.0.0.0",
});
