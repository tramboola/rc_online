import { describe, expect, it } from "vitest";

import { driveSessionExpiresAt } from "./drive-session-store";

describe("driveSessionExpiresAt", () => {
  it("expires a drive exactly five minutes after server creation", () => {
    expect(
      driveSessionExpiresAt(new Date("2026-08-21T12:00:00.000Z")),
    ).toEqual(new Date("2026-08-21T12:05:00.000Z"));
  });
});
