// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileDriveControls } from "./mobile-drive-controls";

class TestDeviceOrientationEvent extends Event {
  static requestPermission = vi.fn(async () => "granted" as const);

  readonly beta: number | null;
  readonly gamma: number | null;

  constructor(type: string, values: { beta?: number | null; gamma?: number | null } = {}) {
    super(type);
    this.beta = values.beta ?? null;
    this.gamma = values.gamma ?? null;
  }
}

describe("MobileDriveControls readiness feedback", () => {
  it("drops throttle and pointer capture on pause even when tilt was never enabled", () => {
    class Pointer extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", Pointer);
    const onInput = vi.fn();
    const view = render(<MobileDriveControls disabled={false} onInput={onInput} />);
    const track = screen.getByLabelText("Proportional throttle and reverse");
    let captured: number | null = null;
    track.setPointerCapture = (id) => { captured = id; };
    track.hasPointerCapture = (id) => captured === id;
    track.releasePointerCapture = (id) => { if (captured === id) captured = null; };
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ top: 0, height: 200 } as DOMRect);
    fireEvent.pointerDown(track, { pointerId: 1, clientY: 0 });
    expect(onInput).toHaveBeenLastCalledWith({ steering: 0, throttle: 1, nitro: false });
    view.rerender(<MobileDriveControls disabled={true} onInput={onInput} />);
    expect(onInput).toHaveBeenLastCalledWith({ steering: 0, throttle: 0, nitro: false });
    expect(captured).toBeNull();
    view.rerender(<MobileDriveControls disabled={false} onInput={onInput} />);
    onInput.mockClear();
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 0 });
    expect(onInput).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "NITRO" }), { pointerId: 2 });
    expect(onInput).toHaveBeenLastCalledWith({ steering: 0, throttle: 0, nitro: true });
    fireEvent.pointerDown(track, { pointerId: 3, clientY: 0 });
    expect(onInput).toHaveBeenLastCalledWith({ steering: 0, throttle: 1, nitro: true });
  });

  beforeEach(() => {
    vi.stubGlobal("DeviceOrientationEvent", TestDeviceOrientationEvent);
    Object.defineProperty(window, "DeviceOrientationEvent", {
      configurable: true,
      value: TestDeviceOrientationEvent,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports real motion and touch input to a preflight consumer", async () => {
    const onTiltActivity = vi.fn();
    const onTouchActivity = vi.fn();

    render(
      <MobileDriveControls
        disabled={false}
        onInput={vi.fn()}
        onTiltActivity={onTiltActivity}
        onTouchActivity={onTouchActivity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "ENABLE TILT STEERING" }));
    await waitFor(() => expect(TestDeviceOrientationEvent.requestPermission).toHaveBeenCalled());
    await screen.findByRole("button", { name: "RE-CENTER" });

    fireEvent(window, new TestDeviceOrientationEvent("deviceorientation", { gamma: 12 }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "NITRO" }));

    expect(onTiltActivity).toHaveBeenCalledTimes(1);
    expect(onTouchActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps throttle output visual without showing a numeric percentage", () => {
    render(
      <MobileDriveControls
        disabled={false}
        onInput={vi.fn()}
      />,
    );

    const track = screen.getByLabelText("Proportional throttle and reverse");
    expect(track.parentElement?.textContent).not.toContain("%");
  });
});
