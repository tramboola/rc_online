import { describe, expect, it, vi } from "vitest";

import { RideMediaPlayback } from "./ride-media-playback";

function harness(audio = true) {
  const video = { srcObject: null, muted: true, volume: 1, play: vi.fn(async (): Promise<void> => undefined), pause: vi.fn() };
  const stream = { getAudioTracks: () => audio ? [{ kind: "audio" }] : [] } as unknown as MediaStream;
  const onState = vi.fn();
  const onError = vi.fn();
  const playback = new RideMediaPlayback(video as unknown as HTMLVideoElement, onState, onError);
  return { playback, video, stream, onState, onError };
}

describe("ride media playback", () => {
  it("starts the onboard stream with sound by default", async () => {
    const { playback, video, stream, onState } = harness();
    await playback.attach(stream);
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith({ hasAudio: true, muted: false, volume: 1, blocked: false });
  });

  it("keeps video playing when the browser requires a gesture for sound", async () => {
    const { playback, video, stream, onState, onError } = harness();
    video.play.mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
    await playback.attach(stream);
    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ blocked: true, muted: false }));
    expect(onError).not.toHaveBeenCalled();

    await playback.resumeFromGesture();
    expect(video.muted).toBe(false);
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ blocked: false }));
  });

  it("honors mute and volume without changing remote tracks or drive transport", async () => {
    const { playback, video, stream, onState } = harness();
    await playback.attach(stream);
    await playback.setMuted(true);
    playback.setVolume(0.35);
    await playback.resumeFromGesture();
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.35);
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true, volume: 0.35 }));
    await playback.setMuted(false);
    expect(video.muted).toBe(false);
  });

  it("preserves video-only agents and still reports actual video playback failures", async () => {
    const { playback, video, stream, onState, onError } = harness(false);
    await playback.attach(stream);
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ hasAudio: false }));
    video.play.mockRejectedValueOnce(new DOMException("Unsupported video", "NotSupportedError"));
    await playback.attach(stream);
    expect(onError).toHaveBeenCalledWith("Browser could not start the camera video");
  });

  it("does not apply an old rejected play request after unmount", async () => {
    const { playback, video, stream, onError } = harness();
    let reject!: (reason: Error) => void;
    video.play.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const pending = playback.attach(stream);
    playback.close();
    reject(new DOMException("Interrupted", "AbortError"));
    await pending;
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
});
