// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobilePreflight } from "./mobile-preflight";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

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

describe("MobilePreflight", () => {
  beforeEach(() => {
    push.mockReset();
    TestDeviceOrientationEvent.requestPermission.mockClear();
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

  it("unlocks the queue only after both motion and touch controls respond", async () => {
    render(<MobilePreflight />);

    const continueButton = screen.getByRole("button", { name: /continue to queue/i });
    expect(continueButton).toHaveProperty("disabled", true);

    fireEvent.pointerDown(screen.getByRole("button", { name: "NITRO" }));
    expect(continueButton).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "ENABLE TILT STEERING" }));
    await waitFor(() => expect(TestDeviceOrientationEvent.requestPermission).toHaveBeenCalled());
    await screen.findByRole("button", { name: "RE-CENTER" });
    fireEvent(window, new TestDeviceOrientationEvent("deviceorientation", { beta: 8, gamma: 12 }));

    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
    fireEvent.click(continueButton);

    expect(push).toHaveBeenCalledWith("/queue");
  });

  it("keeps the queue locked when motion works but no touch control was tried", async () => {
    render(<MobilePreflight />);

    const continueButton = screen.getByRole("button", { name: /continue to queue/i });
    fireEvent.click(screen.getByRole("button", { name: "ENABLE TILT STEERING" }));
    await screen.findByRole("button", { name: "RE-CENTER" });
    fireEvent(window, new TestDeviceOrientationEvent("deviceorientation", { beta: 8, gamma: 12 }));

    await waitFor(() => expect(screen.getByText("TILT DETECTED")).toBeTruthy());
    expect(continueButton).toHaveProperty("disabled", true);
    expect(push).not.toHaveBeenCalled();
  });
});
