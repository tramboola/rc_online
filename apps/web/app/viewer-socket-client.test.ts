import { afterEach, describe, expect, it, vi } from "vitest";

import { connectViewerSocket } from "./viewer-socket-client";

function socketHarness() {
  const sockets: Array<{
    close: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    onclose: null | (() => void);
    onerror: null | (() => void);
    onmessage: null | ((event: { data: unknown }) => void);
  }> = [];
  const urls: string[] = [];
  const createSocket = (url: string) => {
    urls.push(url);
    const socket = {
      close: vi.fn(),
      send: vi.fn(),
      onclose: null as null | (() => void),
      onerror: null as null | (() => void),
      onmessage: null as null | ((event: { data: unknown }) => void),
    };
    sockets.push(socket);
    return socket;
  };
  return { createSocket, sockets, urls };
}

describe("connectViewerSocket", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes only valid version-one viewer counts", () => {
    const { createSocket, sockets, urls } = socketHarness();
    const counts: number[] = [];

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "rcmania.live", protocol: "https:" },
      onCount: (count) => counts.push(count),
      onStatus: () => undefined,
    });
    const socket = sockets[0]!;

    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 4 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 2, type: "viewer.count", count: 5 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: -1 }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 1.5 }) });
    socket.onmessage?.({ data: "not json" });

    expect(urls).toEqual(["wss://rcmania.live/gateway/v1/viewers"]);
    expect(counts).toEqual([4]);
    cleanup();
  });

  it("does not send data and cancels a pending reconnect when cleaned up", () => {
    vi.useFakeTimers();
    const { createSocket, sockets, urls } = socketHarness();

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "localhost:3000", protocol: "http:" },
      onCount: () => undefined,
      onStatus: () => undefined,
    });
    const socket = sockets[0]!;
    socket.onclose?.();
    cleanup();
    vi.advanceTimersByTime(15_000);

    expect(urls).toEqual(["ws://localhost:3000/gateway/v1/viewers"]);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("ignores message, error, and close callbacks after cleanup", () => {
    vi.useFakeTimers();
    const { createSocket, sockets } = socketHarness();
    const counts: number[] = [];
    const statuses: string[] = [];

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "rcmania.live", protocol: "https:" },
      onCount: (count) => counts.push(count),
      onStatus: (status) => statuses.push(status),
    });
    const socket = sockets[0]!;
    cleanup();

    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "viewer.count", count: 8 }) });
    socket.onerror?.();
    socket.onclose?.();
    vi.advanceTimersByTime(15_000);

    expect(counts).toEqual([]);
    expect(statuses).toEqual(["connecting"]);
    expect(sockets).toHaveLength(1);
  });

  it("reconnects after 1, 2, 4, 8, and capped 15 second delays, then resets", () => {
    vi.useFakeTimers();
    const { createSocket, sockets } = socketHarness();

    const cleanup = connectViewerSocket({
      createSocket,
      location: { host: "rcmania.live", protocol: "https:" },
      onCount: () => undefined,
      onStatus: () => undefined,
    });

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000];
    for (const [index, delay] of expectedDelays.entries()) {
      sockets[index]!.onclose?.();
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(index + 2);
    }

    const latestSocket = sockets.at(-1)!;
    latestSocket.onmessage?.({
      data: JSON.stringify({ v: 1, type: "viewer.count", count: 0 }),
    });
    latestSocket.onclose?.();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(7);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(8);
    cleanup();
  });
});
