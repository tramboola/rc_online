// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RideConnectionAttemptCallbacks } from "./ride-connection-attempt";

const fixture = vi.hoisted(() => ({ callbacks: null as RideConnectionAttemptCallbacks | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./ride-connection-attempt", () => ({
  createRideConnectionAttemptDependencies: () => ({}),
  RideConnectionAttempt: class {
    constructor(_carId: string, callbacks: RideConnectionAttemptCallbacks) { fixture.callbacks = callbacks; }
    async start() {}
    close() {}
    fail() {}
  },
}));

import { RealRideScreen } from "./real-ride-screen";

const stream = { getAudioTracks: () => [{ kind: "audio" }] } as unknown as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("saved onboard sound in the real driving screen", () => {
  it("plays video silently while loading, then restores account volume without a full-volume burst", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((done) => { resolve = done; }));
    const { container } = render(<RealRideScreen />);
    await act(async () => { fixture.callbacks!.onStream(stream); });
    const video = container.querySelector("video")!;
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0);
    await act(async () => {
      resolve(Response.json({ accountId: "one", volumePercent: 23, muted: false, revision: 5 }));
    });
    expect(video.volume).toBe(0.23);
    expect(video.muted).toBe(false);
    expect((screen.getByRole("slider", { name: "Onboard sound volume" }) as HTMLInputElement).value).toBe("23");
  });

  it("restores mute and volume for the same account on another ride and keeps accounts separate", async () => {
    let subject = "one";
    const accounts = new Map([
      ["one", { volumePercent: 45, muted: false, revision: 1 }],
      ["two", { volumePercent: 70, muted: false, revision: 3 }],
    ]);
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body));
        accounts.set(subject, { ...body, revision: body.revision + 1 });
      }
      return Response.json({ ...accounts.get(subject), accountId: subject });
    });
    const first = render(<RealRideScreen />);
    await act(async () => { fixture.callbacks!.onStream(stream); });
    fireEvent.change(screen.getByRole("slider", { name: "Onboard sound volume" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Mute onboard sound" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(accounts.get("one")).toMatchObject({ volumePercent: 12, muted: true });
    first.unmount();

    const second = render(<RealRideScreen />);
    await act(async () => { fixture.callbacks!.onStream(stream); });
    expect(second.container.querySelector("video")!.volume).toBe(0.12);
    expect(second.container.querySelector("video")!.muted).toBe(true);
    second.unmount();

    subject = "two";
    const otherAccount = render(<RealRideScreen />);
    await act(async () => { fixture.callbacks!.onStream(stream); });
    expect(otherAccount.container.querySelector("video")!.volume).toBe(0.7);
    expect(otherAccount.container.querySelector("video")!.muted).toBe(false);
  });
});
