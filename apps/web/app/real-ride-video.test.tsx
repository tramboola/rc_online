// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RideConnectionAttemptCallbacks } from "./ride-connection-attempt";

const { attempts } = vi.hoisted(() => ({ attempts: [] as RideConnectionAttemptCallbacks[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./ride-connection-attempt", () => ({
  createRideConnectionAttemptDependencies: vi.fn(),
  RideConnectionAttempt: class {
    constructor(_carId: string, callbacks: RideConnectionAttemptCallbacks) { attempts.push(callbacks); }
    async start() {}
    close() {}
  },
}));
import { RealRideScreen } from "./real-ride-screen";

afterEach(() => { cleanup(); attempts.length = 0; });

it("updates the visible received resolution and measured FPS, then clears stale measurements", () => {
  render(<RealRideScreen />);
  const callbacks = attempts[attempts.length - 1]!;
  act(() => callbacks.onVideoStats?.({ width: 1280, height: 720, fps: 29, rttMs: 80, jitterMs: 5, lossRatio: 0, jitterBufferMs: 20, stalled: false }));
  expect(screen.getByLabelText("Received video format").textContent).toBe("1280×720 · 29 FPS");
  act(() => callbacks.onVideoStats?.({ width: 640, height: 360, fps: 27, rttMs: 80, jitterMs: 5, lossRatio: 0, jitterBufferMs: 20, stalled: false }));
  expect(screen.getByLabelText("Received video format").textContent).toBe("640×360 · 27 FPS");
  act(() => callbacks.onVideoStats?.(null));
  expect(screen.getByLabelText("Received video format").textContent).toBe("VIDEO · —");
});

it("labels the onboard camera without naming a different car", () => {
  render(<RealRideScreen />);

  expect(screen.getByLabelText("Live onboard camera")).toBeTruthy();
});
