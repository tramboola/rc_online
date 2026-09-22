// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RideVideoSafety, VIDEO_FREEZE_TIMEOUT_MS } from "./ride-video-safety";

const watchers: RideVideoSafety[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(mode: "presented" | "counter" | "time" = "presented") {
  const video = document.createElement("video");
  const stream = {} as MediaStream;
  video.srcObject = stream;
  Object.defineProperties(video, {
    readyState: { value: 2, configurable: true },
    paused: { value: false, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 360, configurable: true },
  });
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let nextHandle = 0;
  let presentedFrames = 0;
  const quality = { totalVideoFrames: 0, droppedVideoFrames: 0 };
  if (mode === "presented") {
    video.requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      callbacks.set(++nextHandle, callback);
      return nextHandle;
    });
    video.cancelVideoFrameCallback = vi.fn((handle: number) => { callbacks.delete(handle); });
  }
  if (mode === "counter") {
    video.getVideoPlaybackQuality = () => quality as VideoPlaybackQuality;
  }
  const changes = vi.fn();
  const watcher = new RideVideoSafety(video, changes);
  watchers.push(watcher);
  watcher.watch(stream);
  const frame = (count = ++presentedFrames) => {
    const entry = callbacks.entries().next().value!;
    callbacks.delete(entry[0]);
    entry[1](performance.now(), { presentedFrames: count } as VideoFrameCallbackMetadata);
  };
  return { video, stream, watcher, changes, frame, quality, callbacks };
}

describe("local camera frame safety", () => {
  it("requires real frame evidence and expires it after one second even while media time advances", () => {
    const { watcher, video, frame, changes } = harness();
    video.dispatchEvent(new Event("loadeddata"));
    expect(watcher.isFresh()).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    frame();
    expect(watcher.isFresh()).toBe(true);
    vi.advanceTimersByTime(VIDEO_FREEZE_TIMEOUT_MS - 1);
    expect(watcher.isFresh()).toBe(true);
    video.currentTime = 5;
    vi.advanceTimersByTime(1);
    expect(watcher.isFresh()).toBe(false);
    expect(changes.mock.calls).toEqual([[true], [false]]);
    frame();
    expect(changes.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("does not count repeated presentation metadata as a fresh frame", () => {
    const { watcher, frame } = harness();
    frame(10);
    vi.advanceTimersByTime(600);
    frame(10);
    vi.advanceTimersByTime(400);
    expect(watcher.isFresh()).toBe(false);
  });

  it("falls back to frame-counter progress, excluding dropped frames and media-clock-only changes", () => {
    const { watcher, quality, video } = harness("counter");
    quality.totalVideoFrames = 1;
    quality.droppedVideoFrames = 1;
    video.currentTime = 1;
    vi.advanceTimersByTime(100);
    expect(watcher.isFresh()).toBe(false);
    quality.totalVideoFrames = 2;
    vi.advanceTimersByTime(100);
    expect(watcher.isFresh()).toBe(true);
    video.currentTime = 10;
    vi.advanceTimersByTime(VIDEO_FREEZE_TIMEOUT_MS);
    expect(watcher.isFresh()).toBe(false);
  });

  it("uses currentTime progress only when frame APIs are unavailable, without trusting initial data", () => {
    const { watcher, video } = harness("time");
    video.dispatchEvent(new Event("loadeddata"));
    expect(watcher.isFresh()).toBe(false);
    video.currentTime = 0.03;
    vi.advanceTimersByTime(100);
    expect(watcher.isFresh()).toBe(true);
    vi.advanceTimersByTime(VIDEO_FREEZE_TIMEOUT_MS);
    expect(watcher.isFresh()).toBe(false);
  });

  it("invalidates hidden or paused video until another visible playing frame arrives", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { watcher, frame, video } = harness();
    frame();
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    frame();
    expect(watcher.isFresh()).toBe(false);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(watcher.isFresh()).toBe(false);
    frame();
    expect(watcher.isFresh()).toBe(true);
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    video.dispatchEvent(new Event("pause"));
    expect(watcher.isFresh()).toBe(false);
  });

  it("discards old-stream callbacks, but does not reset a duplicate stream notification", () => {
    const { watcher, video, stream, frame, callbacks, changes } = harness();
    frame();
    watcher.watch(stream);
    expect(watcher.isFresh()).toBe(true);
    const stale = callbacks.values().next().value!;
    const replacement = {} as MediaStream;
    video.srcObject = replacement;
    watcher.watch(replacement);
    expect(watcher.isFresh()).toBe(false);
    stale(performance.now(), { presentedFrames: 50 } as VideoFrameCallbackMetadata);
    expect(watcher.isFresh()).toBe(false);
    frame();
    expect(watcher.isFresh()).toBe(true);
    expect(changes.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("cancels callbacks, timers and listeners on close and ignores late callbacks", () => {
    const { watcher, video, frame, callbacks, changes } = harness();
    frame();
    const late = callbacks.values().next().value!;
    const removeVideoListener = vi.spyOn(video, "removeEventListener");
    const removeVisibility = vi.spyOn(document, "removeEventListener");
    watcher.close();
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeVideoListener).toHaveBeenCalledWith("pause", watcher.check);
    expect(removeVisibility).toHaveBeenCalledWith("visibilitychange", watcher.check);
    changes.mockClear();
    late(performance.now(), { presentedFrames: 100 } as VideoFrameCallbackMetadata);
    video.dispatchEvent(new Event("loadeddata"));
    vi.advanceTimersByTime(2_000);
    expect(changes).not.toHaveBeenCalled();
    expect(watcher.isFresh()).toBe(false);
  });

  it.each([true, false])("does not reschedule work if the owner closes during freshness=%s notification", (closeWhenFresh) => {
    const { watcher, video, stream, frame, callbacks } = harness();
    watcher.close();
    const closingWatcher = new RideVideoSafety(video, (fresh) => {
      if (fresh === closeWhenFresh) closingWatcher.close();
    });
    watchers.push(closingWatcher);
    closingWatcher.watch(stream);
    frame();
    if (!closeWhenFresh) {
      const replacement = {} as MediaStream;
      video.srcObject = replacement;
      closingWatcher.watch(replacement);
    }
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
