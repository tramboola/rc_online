// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserControlLoop } from "./control-loop";
import type { RideConnectionAttemptCallbacks, RideControlLoop } from "./ride-connection-attempt";

const fixture = vi.hoisted(() => ({
  callbacks: null as RideConnectionAttemptCallbacks | null,
  createLoop: null as ((sessionId: string) => RideControlLoop) | null,
  loop: null as RideControlLoop | null,
  mobileInput: null as ((input: { steering: number; throttle: number; nitro: boolean }) => void) | null,
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => fixture.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("./ride-connection-attempt", () => ({
  createRideConnectionAttemptDependencies: (createLoop: (sessionId: string) => RideControlLoop) => {
    fixture.createLoop = createLoop;
    return {};
  },
  RideConnectionAttempt: class {
    constructor(_carId: string, callbacks: RideConnectionAttemptCallbacks) { fixture.callbacks = callbacks; }
    async start() {}
    markVideoLoadedData() {}
    close() { fixture.loop?.stop(); }
  },
}));
// Device events are external; retain the real screen and real protocol encoder.
vi.mock("./mobile-drive-controls", () => ({
  MobileDriveControls: ({ onInput }: { onInput: NonNullable<typeof fixture.mobileInput> }) => {
    fixture.mobileInput = onInput;
    return null;
  },
}));
import { RealRideScreen } from "./real-ride-screen";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  fixture.loop?.stop();
  fixture.callbacks = null;
  fixture.createLoop = null;
  fixture.loop = null;
  fixture.mobileInput = null;
  fixture.router.push.mockClear();
  fixture.router.replace.mockClear();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup(version: 3 | 4 | 5 = 5, durationMs = 300_000, liveVideo = true) {
  const rendered = render(<RealRideScreen />);
  const video = rendered.container.querySelector("video")!;
  Object.defineProperties(video, {
    readyState: { value: 2, configurable: true },
    paused: { value: false, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 360, configurable: true },
  });
  let frameCallback: VideoFrameRequestCallback | null = null;
  let presentedFrames = 0;
  video.requestVideoFrameCallback = (callback) => { frameCallback = callback; return presentedFrames; };
  video.cancelVideoFrameCallback = () => { frameCallback = null; };
  const frame = () => frameCallback?.(performance.now(), { presentedFrames: ++presentedFrames } as VideoFrameCallbackMetadata);
  const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
  act(() => {
    fixture.callbacks!.onStream(stream);
    if (liveVideo) frame();
  });
  const videoTimer = liveVideo ? setInterval(frame, 40) : null;
  const frames: Array<{ steering: number; throttle: number; nitro: boolean; armed: boolean; v: number }> = [];
  const fast = { readyState: "open", bufferedAmount: 0, send: (data: string) => frames.push(JSON.parse(data)), addEventListener() {}, removeEventListener() {} } as unknown as RTCDataChannel;
  const reliable = { readyState: "open", bufferedAmount: 0, send() {}, addEventListener() {}, removeEventListener() {} } as unknown as RTCDataChannel;
  let loop!: BrowserControlLoop;
  act(() => {
    fixture.callbacks!.onSession({
      sessionId: "keyboard-test", ticket: "local-test", gatewayUrl: "wss://invalid.test",
      expiresAt: new Date(Date.now() + durationMs).toISOString(), steeringTrimPercent: 0,
      controlProtocolVersion: version, iceServers: [], iceTransportPolicy: "all",
    });
    loop = fixture.createLoop!("keyboard-test") as BrowserControlLoop;
    fixture.loop = loop;
    loop.bindChannels(fast, reliable);
    loop.start();
    if (fixture.callbacks!.canArmControls?.() ?? true) loop.arm();
    fixture.callbacks!.onReady(loop, "DIRECT");
    fixture.callbacks!.onSnapshot({ activeStep: 8, entries: [], errorMessage: "", status: "connected" });
  });
  return {
    ...rendered, loop, fast, video, frame, stream,
    stopVideo: () => { if (videoTimer !== null) clearInterval(videoTimer); },
    latest: () => frames.at(-1)!, frames,
  };
}
function tick(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function down(code: string, repeat = false) { fireEvent.keyDown(window, { code, repeat }); }
function up(code: string) { fireEvent.keyUp(window, { code }); }

describe("keyboard commands from the real ride screen", () => {
  it("offers explicit neutral resume after congestion, including phone input", () => {
    const ride = setup();
    act(() => fixture.mobileInput!({ steering: 0.5, throttle: 1, nitro: true }));
    tick(20);
    expect(ride.latest()).toMatchObject({ throttle: 1000, armed: true });
    Object.defineProperty(ride.fast, "bufferedAmount", { value: 500, configurable: true });
    tick(240);
    const resume = ride.getByRole("button", { name: "RESUME CONTROLS" });
    Object.defineProperty(ride.fast, "bufferedAmount", { value: 0, configurable: true });
    // A previously held input cannot be restored by the resume action.
    fireEvent.click(resume);
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, nitro: false, armed: true });
    expect(ride.queryByRole("button", { name: "RESUME CONTROLS" })).toBeNull();
    act(() => fixture.mobileInput!({ steering: 0.5, throttle: 0.5, nitro: false }));
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 500, throttle: 500 });
  });

  it("sends a reverse boost then 40% without relying on repeated key events", () => {
    const ride = setup();
    down("KeyS");
    tick(480);
    expect(ride.latest()).toMatchObject({ v: 5, throttle: -1000, armed: true });
    tick(20);
    expect(ride.latest().throttle).toBe(-400);
    tick(500);
    expect(ride.latest().throttle).toBe(-400);
    up("KeyS");
    tick(20);
    expect(ride.latest().throttle).toBe(0);
  });

  it.each([
    { nitro: false, elapsed: 180, steering: -400 },
    { nitro: true, elapsed: 300, steering: -500 },
  ])("samples the steering ramp with nitro=$nitro, then goes full on gas release", ({ nitro, elapsed, steering }) => {
    const ride = setup();
    down("KeyW");
    if (nitro) down("KeyN");
    tick(3000);
    down("KeyA");
    tick(elapsed);
    expect(ride.latest()).toMatchObject({ steering, throttle: 1000, nitro });
    up("KeyW");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: -1000, throttle: 0, nitro: false });
    up("KeyA");
    tick(20);
    expect(ride.latest().steering).toBe(0);
  });

  it.each([
    { nitro: false, steering: 635, remaining: 120 },
    { nitro: true, steering: 476, remaining: 220 },
  ])("introduces steering smoothing during the first second of gas with nitro=$nitro", ({ nitro, steering, remaining }) => {
    const ride = setup();
    down("ArrowUp");
    if (nitro) down("KeyN");
    tick(700);
    down("ArrowRight");
    tick(200);
    expect(ride.latest().steering).toBe(steering);
    tick(remaining);
    expect(ride.latest().steering).toBe(1000);
  });

  it("transmits Nitro changes immediately but keeps the rate captured at turn start", () => {
    const ride = setup();
    down("KeyW");
    tick(1000);
    down("KeyD");
    tick(180);
    down("KeyN");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 444, nitro: true });
    tick(260);
    expect(ride.latest().steering).toBe(1000);

    up("KeyD");
    down("KeyA");
    tick(300);
    expect(ride.latest()).toMatchObject({ steering: -500, nitro: true });
    up("KeyN");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: -533, nitro: false });
    tick(280);
    expect(ride.latest().steering).toBe(-1000);
  });

  it("does not reset reverse boost on OS key repeat or an overlapping alias", () => {
    const ride = setup();
    down("KeyS");
    tick(300);
    down("KeyS", true);
    down("ArrowDown");
    up("KeyS");
    tick(200);
    expect(ride.latest().throttle).toBe(-400);
    up("ArrowDown");
    down("KeyS");
    tick(20);
    expect(ride.latest().throttle).toBe(-1000);
  });

  it("clears motion on blur and ignores stale repeat events until a fresh press", () => {
    const ride = setup();
    down("KeyS");
    tick(100);
    fireEvent.blur(window);
    tick(1000);
    expect(ride.latest()).toMatchObject({ throttle: 0, steering: 0, armed: false });
    fireEvent.focus(window);
    down("KeyS", true);
    tick(20);
    expect(ride.latest().throttle).toBe(0);
    down("KeyS");
    tick(20);
    expect(ride.latest()).toMatchObject({ throttle: -1000, armed: true });
  });

  it("lets phone input take over without a keyboard sampler or stale keyup overwriting it", () => {
    const ride = setup();
    down("KeyS");
    tick(100);
    act(() => fixture.mobileInput!({ steering: 0.25, throttle: 0.6, nitro: false }));
    tick(600);
    expect(ride.latest()).toMatchObject({ steering: 250, throttle: 600 });
    up("KeyS");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 250, throttle: 600 });
  });

  it("requires fresh video and explicit resume after a hidden page becomes visible", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const ride = setup();
    down("KeyW");
    tick(1000);
    down("KeyD");
    tick(200);
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    tick(600);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, armed: false });
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    down("KeyD", true);
    tick(40);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, armed: false });
    down("KeyD");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, armed: false });
    fireEvent.click(ride.getByRole("button", { name: "RESUME CONTROLS" }));
    down("KeyD");
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 1000, throttle: 0 });
  });

  it("does not restore a timed input after explicit disarm and rearm", () => {
    const ride = setup();
    down("KeyS");
    tick(100);
    act(() => ride.loop.disarm("test safety stop"));
    tick(600);
    act(() => ride.loop.arm());
    tick(20);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, armed: true });
    down("KeyS", true);
    tick(20);
    expect(ride.latest().throttle).toBe(0);
    down("KeyS");
    tick(20);
    expect(ride.latest().throttle).toBe(-1000);
  });

  it("does not resume a timed keyboard command after session expiry", () => {
    const ride = setup(5, 750);
    down("KeyS");
    tick(800);
    expect(ride.latest()).toMatchObject({ steering: 0, throttle: 0, armed: false });
    expect(fixture.router.replace).toHaveBeenCalledWith("/pricing");
    const count = ride.frames.length;
    tick(1000);
    expect(ride.frames).toHaveLength(count);
  });

  it.each([3, 4] as const)("preserves discrete commands for older Pi protocol v%s", (version) => {
    const ride = setup(version);
    down("KeyW");
    tick(1200);
    down("KeyD");
    tick(20);
    expect(ride.latest()).toMatchObject({ v: version, steering: 1, throttle: 1 });
    up("KeyW");
    down("KeyS");
    tick(600);
    expect(ride.latest().throttle).toBe(-1);
  });

  it("blocks startup without frame evidence and cannot resume on loadeddata alone", () => {
    const ride = setup(5, 300_000, false);
    fireEvent.loadedData(ride.video);
    down("KeyW");
    act(() => fixture.mobileInput!({ steering: 1, throttle: 1, nitro: true }));
    tick(20);
    expect(ride.latest()).toMatchObject({ armed: false, steering: 0, throttle: 0, nitro: false });
    expect((ride.getByRole("button", { name: "RESUME CONTROLS" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ride.getByRole("button", { name: "RESUME CONTROLS" }));
    tick(20);
    expect(ride.latest().armed).toBe(false);
    act(() => ride.frame());
    expect((ride.getByRole("button", { name: "RESUME CONTROLS" }) as HTMLButtonElement).disabled).toBe(false);
    tick(20);
    expect(ride.latest().armed).toBe(false);
    fireEvent.click(ride.getByRole("button", { name: "RESUME CONTROLS" }));
    tick(20);
    expect(ride.latest()).toMatchObject({ armed: true, steering: 0, throttle: 0, nitro: false });
  });

  it.each(["keyboard", "phone"])("neutralizes a held %s input on video freeze and never automatically rearms", (input) => {
    const ride = setup();
    if (input === "keyboard") {
      down("KeyW");
      down("KeyD");
      down("KeyN");
    } else {
      act(() => fixture.mobileInput!({ steering: 0.8, throttle: 1, nitro: true }));
    }
    tick(100);
    expect(ride.latest()).toMatchObject({ armed: true, throttle: 1000, nitro: true });
    ride.stopVideo();
    tick(1_000);
    expect(ride.latest()).toMatchObject({ armed: false, steering: 0, throttle: 0, nitro: false });
    expect(ride.container.querySelectorAll('.real-keycap[data-active="true"]').length).toBe(0);
    expect(ride.getByText("Waiting for fresh camera frames. Controls are paused.")).toBeTruthy();
    fireEvent.focus(window);
    down("KeyW");
    act(() => fixture.mobileInput!({ steering: 1, throttle: 1, nitro: true }));
    fireEvent.click(ride.getByRole("button", { name: "RESUME CONTROLS" }));
    tick(20);
    expect(ride.latest().armed).toBe(false);
    act(() => ride.frame());
    fireEvent.focus(window);
    down("KeyW");
    fireEvent(document, new Event("visibilitychange"));
    tick(20);
    expect(ride.latest()).toMatchObject({ armed: false, throttle: 0 });
    fireEvent.click(ride.getByRole("button", { name: "RESUME CONTROLS" }));
    tick(20);
    expect(ride.latest()).toMatchObject({ armed: true, steering: 0, throttle: 0, nitro: false });
    down("KeyW", true);
    tick(20);
    expect(ride.latest().throttle).toBe(0);
    down("KeyW");
    tick(20);
    expect(ride.latest().throttle).toBe(1000);
  });

  it("invalidates old-frame evidence on stream replacement and cleans up when unmounted", async () => {
    const ride = setup();
    down("KeyW");
    tick(100);
    ride.stopVideo();
    act(() => fixture.callbacks!.onStream({ getAudioTracks: () => [] } as unknown as MediaStream));
    tick(20);
    expect(ride.latest()).toMatchObject({ armed: false, throttle: 0 });
    expect((ride.getByRole("button", { name: "RESUME CONTROLS" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => ride.frame());
    tick(20);
    expect(ride.latest().armed).toBe(false);
    await act(async () => { ride.unmount(); });
    const sentBefore = ride.frames.length;
    tick(2_000);
    expect(ride.frames).toHaveLength(sentBefore);
    expect(vi.getTimerCount()).toBe(0);
  });
});
