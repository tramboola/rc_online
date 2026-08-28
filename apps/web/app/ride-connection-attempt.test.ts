import { describe, expect, it, vi } from "vitest";

import { RideConnectionAttempt, type RideConnectionAttemptCallbacks } from "./ride-connection-attempt";
import type { RideBatteryTelemetry, RideConnectionProgress, RideConnectionState, StoredDriveSession } from "./ride-session-client";

type Assert<T extends true> = T;
type IsRequired<T, Key extends keyof T> = {} extends Pick<T, Key> ? false : true;
type ConstructorCallbacks = ConstructorParameters<typeof RideConnectionAttempt>[1];
type ConstructorTelemetryIsRequired = Assert<IsRequired<ConstructorCallbacks, "onTelemetry">>;
type PublicTelemetryIsRequired = Assert<IsRequired<RideConnectionAttemptCallbacks, "onTelemetry">>;

const session: StoredDriveSession = {
  sessionId: "bd450fe7-ec99-4983-a5fe-46ca30f260de",
  ticket: "signed-ticket",
  gatewayUrl: "wss://rcmania.live/gateway/v1/socket",
  expiresAt: "2026-08-17T10:05:00.000Z",
  steeringTrimPercent: 0,
  controlProtocolVersion: 4,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceTransportPolicy: "all",
};

function harness() {
  const client = {
    channels: {
      fast: {} as RTCDataChannel,
      reliable: {} as RTCDataChannel,
    },
    connect: vi.fn(),
    close: vi.fn(),
    onError: (_message: string) => undefined,
    onProgress: (_progress: RideConnectionProgress) => undefined,
    onState: (_state: RideConnectionState) => undefined,
    onStream: (_stream: MediaStream) => undefined,
    onTelemetry: (_telemetry: RideBatteryTelemetry) => undefined,
  };
  const loop = {
    arm: vi.fn(),
    bindChannels: vi.fn(),
    disarm: vi.fn(),
    setInput: vi.fn(),
    setSteeringTrim: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const timeout: { callback: () => void; milliseconds: number } = {
    callback: () => undefined,
    milliseconds: 0,
  };
  const snapshots: Array<{ status: string; errorMessage: string }> = [];
  const callbacks = {
    onReady: vi.fn(),
    onSession: vi.fn(),
    onSnapshot: vi.fn((snapshot: { status: string; errorMessage: string }) => snapshots.push(snapshot)),
    onStream: vi.fn(),
    onTelemetry: vi.fn(),
  };
  const attempt = new RideConnectionAttempt("car-01", callbacks, {
    clearTimeout: vi.fn(),
    createClient: () => client,
    createLoop: () => loop,
    createSession: vi.fn(async () => session),
    now: () => new Date("2026-08-17T10:00:00.000Z"),
    setTimeout: (callback, milliseconds) => {
      timeout.callback = callback;
      timeout.milliseconds = milliseconds;
      return 1;
    },
  });

  return { attempt, callbacks, client, loop, snapshots, timeout };
}

describe("RideConnectionAttempt", () => {
  it("exposes the server-created session before opening WebRTC", async () => {
    const { attempt, callbacks, client } = harness();

    await attempt.start();

    expect(callbacks.onSession).toHaveBeenCalledWith(session);
    expect(callbacks.onSession.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER)
      .toBeLessThan(client.connect.mock.invocationCallOrder[0] ?? 0);
  });

  it("waits for the first decoded frame after WebRTC becomes direct", async () => {
    const { attempt, callbacks, client, loop } = harness();
    await attempt.start();

    client.onState("DIRECT");
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(loop.start).not.toHaveBeenCalled();

    attempt.markVideoLoadedData();
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(loop.arm).toHaveBeenCalledTimes(1);
  });

  it("also becomes ready when the decoded frame arrives before DIRECT", async () => {
    const { attempt, callbacks, client } = harness();
    await attempt.start();

    attempt.markVideoLoadedData();
    expect(callbacks.onReady).not.toHaveBeenCalled();
    client.onState("DIRECT");

    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
  });

  it("accepts TURN as a connected transport after a real frame is decoded", async () => {
    const { attempt, callbacks, client, loop } = harness();
    await attempt.start();

    client.onState("TURN");
    attempt.markVideoLoadedData();

    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onReady).toHaveBeenCalledWith(loop, "TURN");
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(loop.arm).toHaveBeenCalledTimes(1);
  });

  it("times out after 15 seconds and tears down every transport", async () => {
    const { attempt, callbacks, client, loop, snapshots, timeout } = harness();
    await attempt.start();
    expect(timeout.milliseconds).toBe(15_000);

    timeout.callback();

    expect(snapshots.at(-1)).toMatchObject({
      status: "failed",
      errorMessage: "Camera connection timed out",
    });
    expect(loop.disarm).toHaveBeenCalled();
    expect(loop.stop).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
    expect(callbacks.onReady).not.toHaveBeenCalled();
  });

  it("ignores stale client and video callbacks after close", async () => {
    const { attempt, callbacks, client, loop } = harness();
    await attempt.start();

    attempt.close("retrying");
    client.onState("DIRECT");
    client.onStream({} as MediaStream);
    attempt.markVideoLoadedData();

    expect(loop.disarm).toHaveBeenCalled();
    expect(loop.stop).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith("retrying");
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onStream).not.toHaveBeenCalled();
  });

  it("forwards client telemetry only while the connection attempt is active", async () => {
    const { attempt, callbacks, client } = harness();
    await attempt.start();

    client.onTelemetry({ batteryVoltage: 12.6, batteryPercent: 84 });
    attempt.close();
    client.onTelemetry({ batteryVoltage: null, batteryPercent: null });

    expect(callbacks.onTelemetry).toHaveBeenCalledTimes(2);
    expect(callbacks.onTelemetry).toHaveBeenNthCalledWith(1, { batteryVoltage: 12.6, batteryPercent: 84 });
    expect(callbacks.onTelemetry).toHaveBeenNthCalledWith(2, { batteryVoltage: null, batteryPercent: null });
  });

  it("clears live battery telemetry when an active client disconnects", async () => {
    const { attempt, callbacks, client, loop, snapshots } = harness();
    await attempt.start();
    client.onState("DIRECT");
    attempt.markVideoLoadedData();

    client.onTelemetry({ batteryVoltage: 8.279, batteryPercent: 94 });
    client.onState("DISCONNECTED");

    expect(callbacks.onTelemetry).toHaveBeenNthCalledWith(1, {
      batteryVoltage: 8.279,
      batteryPercent: 94,
    });
    expect(callbacks.onTelemetry).toHaveBeenNthCalledWith(2, {
      batteryVoltage: null,
      batteryPercent: null,
    });
    expect(loop.disarm).toHaveBeenCalledWith("connection failed");
    expect(loop.stop).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith("connection failed");
    expect(snapshots.at(-1)).toMatchObject({
      status: "failed",
      errorMessage: "Camera connection was interrupted",
    });
  });

  it("clears live battery telemetry when the session closes", async () => {
    const { attempt, callbacks, client } = harness();
    await attempt.start();
    client.onTelemetry({ batteryVoltage: 8.279, batteryPercent: 94 });

    attempt.close("session ended");

    expect(callbacks.onTelemetry).toHaveBeenLastCalledWith({
      batteryVoltage: null,
      batteryPercent: null,
    });
  });

  it("clears live battery telemetry when the active client reports a failure", async () => {
    const { attempt, callbacks, client } = harness();
    await attempt.start();
    client.onState("DIRECT");
    attempt.markVideoLoadedData();
    client.onTelemetry({ batteryVoltage: 8.279, batteryPercent: 94 });

    client.onError("Gateway connection failed");

    expect(callbacks.onTelemetry).toHaveBeenLastCalledWith({
      batteryVoltage: null,
      batteryPercent: null,
    });
  });
});
