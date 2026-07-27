import { describe, expect, it } from "vitest";

import { assertNoProductionMocks, parseRuntimeEnvironment } from "./index.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://example",
  REDIS_URL: "redis://example",
};

describe("runtime environment guard", () => {
  it("allows simulators outside production", () => {
    const parsed = parseRuntimeEnvironment({
      ...base,
      MOCK_MODE: "true",
      DEVICE_PROVIDER: "simulator",
    });
    expect(parsed.mockMode).toBe(true);
  });

  it("fails closed when any mock flag is enabled in production", () => {
    expect(() =>
      assertNoProductionMocks({
        NODE_ENV: "production",
        MOCK_PAYMENTS: "true",
      }),
    ).toThrow(/Production startup refused/);
  });

  it("rejects simulator adapters in production", () => {
    expect(() =>
      assertNoProductionMocks({
        NODE_ENV: "production",
        DEVICE_PROVIDER: "simulator",
      }),
    ).toThrow(/DEVICE_PROVIDER/);
  });

  it("does not let production inherit development mock defaults", () => {
    expect(() =>
      parseRuntimeEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example",
        REDIS_URL: "redis://example",
      }),
    ).toThrow(/IDENTITY_PROVIDER/);
  });
});
