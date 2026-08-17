import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserControlLoop } from "./control-loop";

afterEach(() => vi.useRealTimers());

function channel() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    readyState: "open",
    send: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  } as unknown as RTCDataChannel & { emit(event: string): void };
}

describe("BrowserControlLoop", () => {
  it("does not transmit armed motion before the reliable channel opens", () => {
    vi.useFakeTimers();
    const fast = channel();
    const reliable = channel();
    Object.defineProperty(reliable, "readyState", { value: "connecting", configurable: true });
    const loop = new BrowserControlLoop("7f2fb843-b03b-442b-848b-b2a249b8702a");
    loop.bindChannels(fast, reliable);
    loop.arm();
    loop.setInput({ throttle: 1 });
    loop.start();
    vi.advanceTimersByTime(20);

    expect(JSON.parse(String(vi.mocked(fast.send).mock.calls.at(-1)?.[0]))).toMatchObject({ armed: false, throttle: 0 });
  });

  it("auto-arms when the reliable channel opens and sends semantic 50 Hz frames", () => {
    vi.useFakeTimers();
    const fast = channel();
    const reliable = channel();
    const sessionId = "7f2fb843-b03b-442b-848b-b2a249b8702a";
    const loop = new BrowserControlLoop(sessionId);
    loop.bindChannels(fast, reliable);
    loop.arm();
    loop.setInput({ steering: -1, throttle: 1, nitro: true });
    loop.start();
    vi.advanceTimersByTime(20);

    expect(JSON.parse(String(vi.mocked(fast.send).mock.calls.at(-1)?.[0]))).toMatchObject({
      v: 3,
      type: "control.intent",
      sessionId,
      sequence: 1,
      steering: -1,
      throttle: 1,
      nitro: true,
      armed: true
    });
    expect(JSON.parse(String(vi.mocked(fast.send).mock.calls.at(-1)?.[0]))).not.toHaveProperty("brake");
    expect(JSON.parse(String(vi.mocked(reliable.send).mock.calls[0]?.[0]))).toMatchObject({ v: 3, type: "arm", sessionId });
    loop.stop();
    expect(JSON.parse(String(vi.mocked(reliable.send).mock.calls.at(-1)?.[0]))).toMatchObject({ type: "neutral", sessionId });
  });

  it("queues automatic arming until a connecting reliable channel opens", () => {
    const fast = channel();
    const reliable = channel();
    Object.defineProperty(reliable, "readyState", { value: "connecting", configurable: true });
    const loop = new BrowserControlLoop("session-1");
    loop.bindChannels(fast, reliable);

    loop.arm();
    expect(reliable.send).not.toHaveBeenCalled();

    Object.defineProperty(reliable, "readyState", { value: "open", configurable: true });
    (reliable as RTCDataChannel & { emit(event: string): void }).emit("open");

    expect(JSON.parse(String(vi.mocked(reliable.send).mock.calls[0]?.[0]))).toMatchObject({
      v: 3,
      type: "arm",
      sessionId: "session-1",
    });
  });
});
