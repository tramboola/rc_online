// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SimulationScreen } from "./simulation-screen";
import type { LiveQueueSnapshot } from "./live-queue-store";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/queue", useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(), signOut: vi.fn(), useSession: () => ({ data: null, status: "unauthenticated" }),
}));

const ready: LiveQueueSnapshot = {
  entryId: "offer-1", position: 1, count: 2, availableCarCount: 1, status: "ready",
  serverNow: "2030-01-01T12:00:00.000Z", offerExpiresAt: "2030-01-01T12:00:15.000Z",
  cars: [{ id: "car-1", slug: "rc-mania-one", name: "RC Mania One", batteryPercent: 47, availability: "available" }],
};
let response: LiveQueueSnapshot;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(ready.serverNow!));
  response = ready;
  push.mockReset();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => response }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function show(snapshot = ready) {
  response = snapshot;
  await act(async () => { render(<SimulationScreen adminAccess mockMode screen="queue" liveQueueSnapshot={snapshot} />); });
}

it("shows the 15-second deadline and cannot accept after it even if polling stalls", async () => {
  await show();
  expect(screen.getByText(/ACCEPT WITHIN/).textContent).toContain("00:15");
  expect((screen.getByRole("button", { name: "ACCEPT & CONNECT" }) as HTMLButtonElement).disabled).toBe(false);
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("heading", { name: "OFFER EXPIRED" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "ACCEPT & CONNECT" })).toBeNull();
  expect(push).not.toHaveBeenCalled();
});

it("does not automatically rejoin on mount or poll, but explicit rejoin sends POST", async () => {
  await show({ ...ready, status: "expired", position: 0, offerExpiresAt: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(4_100); });
  expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
  response = { ...ready, entryId: "offer-2", serverNow: "2030-01-01T12:00:04.100Z", offerExpiresAt: "2030-01-01T12:00:19.100Z" };
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "REJOIN QUEUE" })); });
  expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true);
  expect(screen.getByRole("heading", { name: "YOUR CAR IS READY" })).toBeTruthy();
});

it("explains that a free car is offered to earlier drivers, not available to user #2", async () => {
  await show({ ...ready, status: "waiting", position: 2, offerExpiresAt: null });
  expect(screen.getByText("OFFERED TO NEXT DRIVER")).toBeTruthy();
  expect((screen.getByRole("button", { name: "ACCEPT & CONNECT" }) as HTMLButtonElement).disabled).toBe(true);
});

it("disables accepting when the live queue cannot be refreshed", async () => {
  await show();
  fetchMock.mockRejectedValue(new Error("offline"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
  expect((screen.getByRole("button", { name: "ACCEPT & CONNECT" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Queue connection interrupted");
});

it("does not allow accepting an initial server snapshot until a fresh GET succeeds", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await show();
  expect((screen.getByRole("button", { name: "ACCEPT & CONNECT" }) as HTMLButtonElement).disabled).toBe(true);
});

it("ignores a late GET from before explicit rejoining", async () => {
  let finishOldRequest!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve; }));
  const expired = { ...ready, status: "expired" as const, position: 0, offerExpiresAt: null };
  await show(expired);
  response = { ...ready, entryId: "new-offer" };
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "REJOIN QUEUE" })); });
  await act(async () => { finishOldRequest({ ok: true, json: async () => expired }); });
  expect(screen.getByRole("heading", { name: "YOUR CAR IS READY" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "ACCEPT & CONNECT" }) as HTMLButtonElement).disabled).toBe(false);
});
