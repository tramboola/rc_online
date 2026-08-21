import { describe, expect, it } from "vitest";

import { parseAgentReleaseManifest } from "./register-agent-release.js";

const valid = {
  artifactSizeBytes: 1024,
  artifactUrl: "https://rcmania.live/agent-releases/rc-pi-agent-0.4.1.pyz",
  channel: "stable",
  componentKind: "pi-agent",
  digestSha256: "a".repeat(64),
  runtimeGeneration: 1,
  signature: "b".repeat(86),
  version: "0.4.1",
};

describe("agent release registration", () => {
  it("accepts exact immutable production metadata", () => {
    expect(parseAgentReleaseManifest(valid)).toEqual(valid);
  });

  it("rejects a mutable URL, bad digest, oversized artifact, and extra keys", () => {
    expect(() => parseAgentReleaseManifest({ ...valid, artifactUrl: "https://evil.test/a.pyz" })).toThrow();
    expect(() => parseAgentReleaseManifest({ ...valid, digestSha256: "A".repeat(64) })).toThrow();
    expect(() => parseAgentReleaseManifest({ ...valid, artifactSizeBytes: 8 * 1024 * 1024 + 1 })).toThrow();
    expect(() => parseAgentReleaseManifest({ ...valid, privateKey: "secret" })).toThrow();
  });
});
