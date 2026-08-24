import { describe, expect, it, vi } from "vitest";

import { connectViewerSocket } from "./viewer-socket-client";

function socketHarness() {
  const socket = {
    close: vi.fn(),
    send: vi.fn(),
    onclose: null as null | (() => void),
    onerror: null as null | (() => void),
    onmessage: null as null | ((event: { data: unknown }) => void),
  };
  const createSocket = vi.fn(() => socket);
  return { socket, createSocket };
}

describe("connectViewerSocket", () => {
  it("publishes only valid version-one viewer counts", () => {
    const { createSocket, socket } = socketHarness();
    const counts: number[] = [];

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "rcmania.live", protocol: "https:" },
      onCount: (count) => counts.push(count),
      onStatus: () => undefined,
    });

    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 4 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 2, type: "viewer.count", count: 5 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: -1 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 1.5 }) });
    socket.onmessage?.({ data: "not json" });

    expect(createSocket).toHaveBeenCalledWith("wss://rcmania.live/gateway/v1/viewers");
    expect(counts).toEqual([4]);
    cleanup();
  });

  it("does not send data and cancels a pending reconnect when cleaned up", () => {
    vi.useFakeTimers();
    const { createSocket, socket } = socketHarness();

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "localhost:3000", protocol: "http:" },
      onCount: () => undefined,
      onStatus: () => undefined,
    });
    socket.onclose?.();
    cleanup();
    vi.advanceTimersByTime(15_000);

    expect(createSocket).toHaveBeenCalledWith("ws://localhost:3000/gateway/v1/viewers");
    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("backs off reconnects and resets after receiving a valid count", () => {
    vi.useFakeTimers();
    const { createSocket, socket } = socketHarness();

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "rcmania.live", protocol: "https:" },
      onCount: () => undefined,
      onStatus: () => undefined,
    });

    socket.onclose?.();
    vi.advanceTimersByTime(999);
    expect(createSocket).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(createSocket).toHaveBeenCalledTimes(2);
    socket.onclose?.();
    vi.advanceTimersByTime(2_000);
    expect(createSocket).toHaveBeenCalledTimes(3);
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 0 }) });
    socket.onclose?.();
    vi.advanceTimersByTime(1_000);

    expect(createSocket).toHaveBeenCalledTimes(4);
    cleanup();
    vi.useRealTimers();
  });
});
