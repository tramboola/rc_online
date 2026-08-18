import { describe, expect, it, vi } from "vitest";

import { RideConnectionAttempt } from "./ride-connection-attempt";
import type { RideConnectionProgress, RideConnectionState, StoredDriveSession } from "./ride-session-client";

const session: StoredDriveSession = {
  sessionId: "bd450fe7-ec99-4983-a5fe-46ca30f260de",
  ticket: "signed-ticket",
  gatewayUrl: "wss://rcmania.live/gateway/v1/socket",
  expiresAt: "2026-08-17T10:05:00.000Z",
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
  };
  const loop = {
    arm: vi.fn(),
    bindChannels: vi.fn(),
    disarm: vi.fn(),
    setInput: vi.fn(),
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
    onSnapshot: vi.fn((snapshot: { status: string; errorMessage: string }) => snapshots.push(snapshot)),
    onStream: vi.fn(),
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
});
