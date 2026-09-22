import { describe, expect, it } from "vitest";
import { AdaptiveVideoPolicy, formatVideoStreamStats, type VideoStreamStats } from "./adaptive-video";

const profiles = ["720p30", "540p30", "360p30", "240p30"] as const;
const good: VideoStreamStats = { width: 640, height: 360, fps: 30, rttMs: 60,
  jitterMs: 10, lossRatio: 0, jitterBufferMs: 20, stalled: false };

describe("receiver bandwidth coordinated with resolution", () => {
  it("displays 240p normally without an emergency marker or target-FPS substitution", () => {
    expect(formatVideoStreamStats({ width: 426, height: 240, fps: 27.6 })).toBe("426×240 · 28 FPS");
    expect(formatVideoStreamStats({ width: 426, height: 240, fps: null })).toBe("426×240 · — FPS");
  });

  it.each([
    ["720p30", 1_300_000, "540p30"],
    ["540p30", 750_000, "360p30"],
    ["360p30", 480_000, "240p30"],
  ] as const)("steps %s down before FPS falls, after one second", (current, budget, target) => {
    const policy = new AdaptiveVideoPolicy(profiles, current);
    expect(policy.observeBandwidth(budget, 0, 0)).toBeNull();
    expect(policy.observeBandwidth(budget, 0, 500)).toBeNull();
    expect(policy.observeBandwidth(budget, 0, 1000)).toBe(target);
  });

  it("skips intermediate profiles after a sustained severe collapse", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    expect(policy.observeBandwidth(400_000, 0, 0)).toBeNull();
    expect(policy.observeBandwidth(400_000, 0, 499)).toBeNull();
    expect(policy.observeBandwidth(400_000, 0, 500)).toBe("240p30");
    expect(policy.observeBandwidth(300_000, 0, 1000)).toBeNull(); // waiting for ACK
  });

  it("does not reset a persistent shortage when estimates straddle lower-profile thresholds", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    expect(policy.observeBandwidth(900_000, 0, 0)).toBeNull();
    expect(policy.observeBandwidth(700_000, 0, 500)).toBeNull();
    expect(policy.observeBandwidth(900_000, 0, 1000)).toBe("540p30");
  });

  it("requires continuous severe evidence for the shorter downgrade timer", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    expect(policy.observeBandwidth(400_000, 0, 0)).toBeNull();
    expect(policy.observeBandwidth(900_000, 0, 250)).toBeNull();
    expect(policy.observeBandwidth(400_000, 0, 500)).toBeNull();
    expect(policy.observeBandwidth(600_000, 0, 750)).toBeNull();
    expect(policy.observeBandwidth(600_000, 0, 1000)).toBe("360p30");
  });

  it("bypasses the old eight-second lock for a further budget downgrade", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    policy.observeBandwidth(1_200_000, 0, 0);
    expect(policy.observeBandwidth(1_200_000, 0, 1000)).toBe("540p30");
    policy.acknowledge("540p30", 1100);
    expect(policy.observeBandwidth(700_000, 0, 1200)).toBeNull();
    expect(policy.observeBandwidth(700_000, 0, 1700)).toBeNull();
    expect(policy.observeBandwidth(700_000, 0, 2200)).toBe("360p30");
  });

  it("resets evidence for a short dip, unknown/stale estimate or telemetry gap", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    policy.observeBandwidth(1_200_000, 0, 0);
    expect(policy.observeBandwidth(2_000_000, 0, 500)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 0, 1000)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 2000, 1500)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 0, 2000)).toBeNull();
    expect(policy.observeBandwidth(null, null, 2500)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 0, 3000)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 0, 7000)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 0, 8000)).toBe("540p30");
  });

  it("does not treat repeated stale source estimates as new evidence", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    policy.observeBandwidth(1_200_000, 1400, 0);
    expect(policy.observeBandwidth(1_200_000, 1900, 500)).toBeNull();
    expect(policy.observeBandwidth(1_200_000, 2400, 1000)).toBeNull();
  });

  it("requires six healthy seconds AND bandwidth headroom, not just good FPS", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    for (let now = 0; now <= 12000; now += 1000) {
      policy.observeBandwidth(800_000, 0, now);
      expect(policy.observe(good, now)).toBeNull();
    }
    for (let now = 13000; now < 19000; now += 1000) {
      policy.observeBandwidth(1_100_000, 0, now);
      expect(policy.observe(good, now)).toBeNull();
    }
    policy.observeBandwidth(1_100_000, 0, 19000);
    expect(policy.observe(good, 19000)).toBe("540p30");
  });

  it("does not upgrade after feedback disappears even if receive stats look good", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "240p30");
    policy.observeBandwidth(900_000, 0, 0);
    for (let now = 0; now <= 20000; now += 1000) expect(policy.observe(good, now)).toBeNull();
  });

  it("accepts only matching profile acknowledgements and bounds retries", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    const changes: string[] = [];
    for (let now = 0; now <= 30000; now += 500) {
      const target = policy.observeBandwidth(400_000, 0, now);
      if (target) changes.push(target);
      policy.acknowledge("540p30", now); // cannot unlock requests or rewrite current
    }
    expect(changes).toEqual(["240p30", "240p30", "240p30"]);
  });

  it("can use 240p for FPS impairment but never requests an unsupported profile", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    const legacy = new AdaptiveVideoPolicy(["720p30", "360p30"], "360p30");
    for (let now = 0; now < 5000; now += 1000) {
      expect(policy.observe({ ...good, fps: 5 }, now)).toBeNull();
      expect(legacy.observe({ ...good, fps: 5 }, now)).toBeNull();
    }
    expect(policy.observe({ ...good, fps: 5 }, 5000)).toBe("240p30");
    expect(legacy.observe({ ...good, fps: 5 }, 5000)).toBeNull();
  });

  it("recovers from a matching late ACK after all three request windows expired", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    const changes: string[] = [];
    for (let now = 0; now <= 17000; now += 500) {
      const profile = policy.observeBandwidth(400_000, 0, now);
      if (profile) changes.push(profile);
    }
    expect(changes).toEqual(["240p30", "240p30", "240p30"]);
    policy.acknowledge("240p30", 17100);
    for (let now = 18000; now < 27000; now += 1000) {
      policy.observeBandwidth(700_000, 0, now);
      expect(policy.observe(good, now)).toBeNull();
    }
    policy.observeBandwidth(700_000, 0, 27000);
    expect(policy.observe(good, 27000)).toBe("360p30");
  });
});
