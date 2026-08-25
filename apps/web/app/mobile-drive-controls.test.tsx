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
