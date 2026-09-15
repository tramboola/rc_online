// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RideAudioControls } from "./ride-audio-controls";
import { INITIAL_RIDE_AUDIO } from "./ride-media-playback";

describe("onboard audio controls", () => {
  afterEach(cleanup);

  it("offers an explicit gesture when autoplay is blocked", () => {
    const onToggle = vi.fn();
    render(<RideAudioControls state={{ ...INITIAL_RIDE_AUDIO, hasAudio: true, blocked: true }} onToggle={onToggle} onVolume={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable onboard sound" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("blocks volume key presses but allows release of an already-held drive key", () => {
    const onVolume = vi.fn();
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();
    render(<div onKeyDown={onKeyDown} onKeyUp={onKeyUp}><RideAudioControls state={{ ...INITIAL_RIDE_AUDIO, hasAudio: true }} onToggle={vi.fn()} onVolume={onVolume} /></div>);
    const slider = screen.getByRole("slider", { name: "Onboard sound volume" });
    fireEvent.keyDown(slider, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyUp(slider, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.change(slider, { target: { value: "35" } });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onKeyUp).toHaveBeenCalledOnce();
    expect(onVolume).toHaveBeenCalledWith(0.35);
  });

  it("does not claim sound is available for a video-only car", () => {
    render(<RideAudioControls state={INITIAL_RIDE_AUDIO} onToggle={vi.fn()} onVolume={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toContain("NO AUDIO");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
  });
});
