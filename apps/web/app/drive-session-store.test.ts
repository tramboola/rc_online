import { describe, expect, it } from "vitest";

import { controlProtocolVersionFromMetadata, driveSessionExpiresAt } from "./drive-session-store";

describe("driveSessionExpiresAt", () => {
  it("expires a drive exactly five minutes after server creation", () => {
    expect(
      driveSessionExpiresAt(new Date("2026-08-21T12:00:00.000Z")),
    ).toEqual(new Date("2026-08-21T12:05:00.000Z"));
  });
});

describe("controlProtocolVersionFromMetadata", () => {
  it("fails safely to v3 unless a device explicitly advertises numeric v4", () => {
    expect(controlProtocolVersionFromMetadata({})).toBe(3);
    expect(controlProtocolVersionFromMetadata({ capabilities: { controlProtocolVersion: "4" } })).toBe(3);
    expect(controlProtocolVersionFromMetadata({ capabilities: { controlProtocolVersion: 4 } })).toBe(4);
  });
});
