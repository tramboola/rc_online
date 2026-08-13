import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserControlLoop } from "./control-loop";

afterEach(() => vi.useRealTimers());

function channel() {
  return { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
}

describe("BrowserControlLoop", () => {
  it("does not transmit armed motion before an explicit arm", () => {
    vi.useFakeTimers();
    const fast = channel();
    const reliable = channel();
    const loop = new BrowserControlLoop("7f2fb843-b03b-442b-848b-b2a249b8702a");
    loop.bindChannels(fast, reliable);
    loop.setInput({ throttle: 700 });
    loop.start();
    vi.advanceTimersByTime(50);

    expect(JSON.parse(String(vi.mocked(fast.send).mock.calls.at(-1)?.[0]))).toMatchObject({ armed: false, throttle: 0 });
  });

  it("sends bounded versioned frames after arm and reliable neutral on stop", () => {
    vi.useFakeTimers();
    const fast = channel();
    const reliable = channel();
    const sessionId = "7f2fb843-b03b-442b-848b-b2a249b8702a";
    const loop = new BrowserControlLoop(sessionId);
    loop.bindChannels(fast, reliable);
    loop.arm();
    loop.setInput({ steering: -700, throttle: 700, brake: 0, nitro: true });
    loop.start();
    vi.advanceTimersByTime(50);

    expect(JSON.parse(String(vi.mocked(fast.send).mock.calls.at(-1)?.[0]))).toMatchObject({
      v: 1,
      type: "control",
      sessionId,
      sequence: 1,
      steering: -700,
      throttle: 700,
      brake: 0,
      nitro: true,
      armed: true
    });
    loop.stop();
    expect(JSON.parse(String(vi.mocked(reliable.send).mock.calls.at(-1)?.[0]))).toMatchObject({ type: "neutral", sessionId });
  });
});
