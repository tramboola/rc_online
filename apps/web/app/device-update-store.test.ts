import { describe, expect, it } from "vitest";

import { isCompleteAgentRelease } from "./device-update-store";

describe("device update store validation", () => {
  it("accepts only complete immutable Pi agent metadata", () => {
    expect(isCompleteAgentRelease({
      componentKind: "pi-agent", version: "0.4.1",
      artifactUrl: "https://rcmania.live/agent-releases/rc-pi-agent-0.4.1.pyz",
      artifactSizeBytes: 1024, runtimeGeneration: 1,
      digestSha256: "a".repeat(64), signature: "b".repeat(86)
    })).toBe(true);
    expect(isCompleteAgentRelease({
      componentKind: "pi-agent", version: "0.4.1", artifactUrl: "http://bad.test/a.pyz",
      artifactSizeBytes: 1024, runtimeGeneration: 1,
      digestSha256: "a".repeat(64), signature: "b".repeat(86)
    })).toBe(false);
  });
});
