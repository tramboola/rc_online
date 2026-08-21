import { describe, expect, it, vi } from "vitest";

import { formatSessionTime, remainingSessionSeconds, SessionCountdown } from "./session-countdown";

describe("session countdown", () => {
  it("derives remaining whole display seconds from an absolute expiry", () => {
    const expiresAt = "2026-08-21T12:05:00.000Z";
    expect(remainingSessionSeconds(expiresAt, new Date("2026-08-21T12:00:00.001Z"))).toBe(300);
    expect(remainingSessionSeconds(expiresAt, new Date("2026-08-21T12:04:00.001Z"))).toBe(60);
    expect(remainingSessionSeconds(expiresAt, new Date("2026-08-21T12:05:00.000Z"))).toBe(0);
  });

  it("formats minutes and seconds", () => {
    expect(formatSessionTime(300)).toBe("05:00");
    expect(formatSessionTime(9)).toBe("00:09");
  });

  it("reports expiry once even if a scheduled tick runs again", () => {
    let now = new Date("2026-08-21T12:00:00.000Z");
    let scheduled: (() => void) | undefined;
    const onTick = vi.fn();
    const onExpire = vi.fn();
    const countdown = new SessionCountdown({
      onTick,
      onExpire,
      now: () => now,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
      cancel: vi.fn(),
    });

    countdown.start("2026-08-21T12:00:01.000Z");
    now = new Date("2026-08-21T12:00:01.000Z");
    scheduled?.();
    scheduled?.();

    expect(onTick).toHaveBeenLastCalledWith(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
