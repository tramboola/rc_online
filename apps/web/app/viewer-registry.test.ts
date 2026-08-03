import { describe, expect, test } from "vitest";

import { isValidViewerId } from "./viewer-id";
import { ViewerRegistry } from "./viewer-registry";

describe("ViewerRegistry", () => {
  test("deduplicates heartbeats from the same browser", () => {
    let now = 1_000;
    const registry = new ViewerRegistry(45_000, () => now);

    expect(registry.heartbeat("browser-a")).toBe(1);
    now += 15_000;
    expect(registry.heartbeat("browser-a")).toBe(1);
    expect(registry.heartbeat("browser-b")).toBe(2);
  });

  test("expires viewers after 45 seconds", () => {
    let now = 1_000;
    const registry = new ViewerRegistry(45_000, () => now);

    registry.heartbeat("browser-a");
    now += 45_001;

    expect(registry.count()).toBe(0);
  });

  test("evicts the oldest viewer when the registry reaches capacity", () => {
    let now = 1_000;
    const registry = new ViewerRegistry(45_000, () => now, 2);

    registry.heartbeat("browser-a");
    now += 1;
    registry.heartbeat("browser-b");
    now += 1;

    expect(registry.heartbeat("browser-c")).toBe(2);
  });

  test("accepts bounded opaque identifiers only", () => {
    expect(isValidViewerId("browser_123-abc")).toBe(true);
    expect(isValidViewerId("")).toBe(false);
    expect(isValidViewerId("contains spaces")).toBe(false);
    expect(isValidViewerId("x".repeat(129))).toBe(false);
  });
});
