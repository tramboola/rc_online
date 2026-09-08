import { describe, expect, it } from "vitest";

import {
  AdaptiveVideoPolicy,
  formatVideoStreamStats,
  VideoStatsSampler,
  type VideoStreamStats,
} from "./adaptive-video";

type StatsEntry = Record<string, unknown> & { id: string; type: string };

function report(...entries: StatsEntry[]): RTCStatsReport {
  return new Map(entries.map((entry) => [entry.id, entry])) as unknown as RTCStatsReport;
}

function inbound(overrides: Record<string, unknown> = {}): StatsEntry {
  return {
    id: "video-in", type: "inbound-rtp", kind: "video", timestamp: 1_000,
    ssrc: 10, codecId: "h264", transportId: "transport", frameWidth: 1280,
    frameHeight: 720, framesDecoded: 60, packetsReceived: 100, packetsLost: 2,
    jitter: 0.012, jitterBufferDelay: 0.6, jitterBufferEmittedCount: 60,
    ...overrides,
  };
}

function videoReport(video: StatsEntry, ...extra: StatsEntry[]): RTCStatsReport {
  return report(
    video,
    { id: "h264", type: "codec", mimeType: "video/H264" },
    { id: "transport", type: "transport", selectedCandidatePairId: "current-pair" },
    { id: "current-pair", type: "candidate-pair", timestamp: video.timestamp,
      state: "succeeded", nominated: true, currentRoundTripTime: 0.08 },
    ...extra,
  );
}

const good: VideoStreamStats = {
  width: 1280, height: 720, fps: 29, rttMs: 80, jitterMs: 12,
  lossRatio: 0, jitterBufferMs: 20, stalled: false,
};
const bad: VideoStreamStats = { ...good, rttMs: 350 };
const profiles = ["720p60", "720p30", "540p30", "360p30"] as const;

function warm(policy: AdaptiveVideoPolicy): void {
  expect(policy.observe(good, 0)).toBeNull();
  expect(policy.observe(good, 1_000)).toBeNull();
  expect(policy.observe(good, 2_000)).toBeNull();
}

describe("VideoStatsSampler", () => {
  it("measures decoded frames and packet loss over the interval, not the lifetime", () => {
    const sampler = new VideoStatsSampler();
    const first = sampler.sample(videoReport(inbound()));
    expect(first.fps).toBeNull();
    expect(first.lossRatio).toBeNull();
    expect(first.jitterBufferMs).toBeNull();
    const next = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      framesDecoded: 89, packetsReceived: 196, packetsLost: 6,
      jitterBufferDelay: 1.18, jitterBufferEmittedCount: 89,
    })));
    expect(next).toEqual({ width: 1280, height: 720, fps: 29, rttMs: 80,
      jitterMs: 12, lossRatio: 0.04, jitterBufferMs: expect.closeTo(20), stalled: false });
  });

  it("uses the active transport pair even when an older nominated pair is present", () => {
    const sampler = new VideoStatsSampler();
    const result = sampler.sample(videoReport(inbound(),
      { id: "old-pair", type: "candidate-pair", state: "succeeded",
        nominated: true, currentRoundTripTime: 1.2 },
    ));
    expect(result.rttMs).toBe(80);
    const switched = sampler.sample(report(inbound({ timestamp: 2_000 }),
      { id: "transport", type: "transport", selectedCandidatePairId: "new-pair" },
      { id: "old-pair", type: "candidate-pair", state: "succeeded",
        nominated: true, currentRoundTripTime: 1.2 },
      { id: "new-pair", type: "candidate-pair", state: "succeeded",
        currentRoundTripTime: 0.04 },
    ));
    expect(switched.rttMs).toBe(40);
  });

  it("does not invent missing Safari counters, dimensions, or latency", () => {
    const sampler = new VideoStatsSampler();
    expect(sampler.sample(report({ id: "safari", type: "inbound-rtp",
      mediaType: "video", timestamp: 1_000,
    }))).toEqual({ width: null, height: null, fps: null, rttMs: null,
      jitterMs: null, lossRatio: null, jitterBufferMs: null, stalled: false });
  });

  it("accepts actual browser-reported FPS when the decoded counter is unavailable", () => {
    const result = new VideoStatsSampler().sample(videoReport(inbound({
      framesDecoded: undefined, framesPerSecond: 27.5,
    })));
    expect(result.fps).toBe(27.5);
  });

  it("ignores RTX and audio even when their counters are larger", () => {
    const result = new VideoStatsSampler().sample(videoReport(inbound(),
      inbound({ id: "retransmission", codecId: "rtx", frameWidth: 160, frameHeight: 90,
        framesDecoded: 99_999, framesPerSecond: 99 }),
      { id: "rtx", type: "codec", mimeType: "video/rtx" },
      inbound({ id: "audio-in", kind: "audio", frameWidth: 1, frameHeight: 1,
        framesDecoded: 999_999, framesPerSecond: 999 }),
    ));
    expect(result.width).toBe(1280);
    expect(result.fps).toBeNull();
  });

  it("reports zero FPS for a measured decode stall", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    const result = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      framesPerSecond: 60, packetsReceived: 200,
    })));
    expect(result.fps).toBe(0);
    expect(result.stalled).toBe(true);
  });

  it("resets deltas after counters reset or the video stream changes", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    const reset = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      framesDecoded: 2, packetsReceived: 4, packetsLost: 0,
      jitterBufferDelay: 0.02, jitterBufferEmittedCount: 2,
    })));
    expect(reset.fps).toBeNull();
    expect(reset.lossRatio).toBeNull();
    expect(reset.jitterBufferMs).toBeNull();
    const changed = sampler.sample(videoReport(inbound({ id: "new-video", ssrc: 20,
      timestamp: 3_000, framesDecoded: 120, packetsReceived: 400,
      frameWidth: 640, frameHeight: 360,
    })));
    expect(changed.width).toBe(640);
    expect(changed.height).toBe(360);
    expect(changed.fps).toBeNull();
    expect(changed.lossRatio).toBeNull();
  });

  it("selects a new receiving stream over an inactive old inbound report", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    const result = sampler.sample(videoReport(inbound({ timestamp: 2_000, active: false }),
      inbound({ id: "new-video", ssrc: 20, timestamp: 2_000,
        frameWidth: 640, frameHeight: 360, framesDecoded: 3 }),
    ));
    expect(result.width).toBe(640);
    expect(result.fps).toBeNull();
  });

  it("does not mistake repeated reports or a background gap for a decode stall", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    const repeated = sampler.sample(videoReport(inbound()));
    expect(repeated.fps).toBeNull();
    expect(repeated.stalled).toBe(false);
    expect(repeated.lossRatio).toBeNull();
    const afterGap = sampler.sample(videoReport(inbound({ timestamp: 20_000 })));
    expect(afterGap.fps).toBeNull();
    expect(afterGap.stalled).toBe(false);
    expect(afterGap.lossRatio).toBeNull();
  });

  it("keeps no-packet loss intervals unknown and rejects invalid measurements", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    const result = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      frameWidth: 0, frameHeight: Number.NaN, framesDecoded: Number.POSITIVE_INFINITY,
      jitter: -0.1, jitterBufferDelay: -1,
    }), { id: "current-pair", type: "candidate-pair", currentRoundTripTime: Number.NaN }));
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
    expect(result.fps).toBeNull();
    expect(result.lossRatio).toBeNull();
    expect(result.jitterMs).toBeNull();
    expect(result.jitterBufferMs).toBeNull();
    expect(result.rttMs).toBeNull();
  });

  it("measures loss when the cumulative lost count is legitimately negative", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound({ packetsLost: -2 })));
    const stable = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      packetsReceived: 200, packetsLost: -2, framesDecoded: 89,
    })));
    expect(stable.lossRatio).toBe(0);
    const newLoss = sampler.sample(videoReport(inbound({ timestamp: 3_000,
      packetsReceived: 299, packetsLost: -1, framesDecoded: 118,
    })));
    expect(newLoss.lossRatio).toBe(0.01);
  });

  it("treats recovered packets as no new loss while preserving counter-reset protection", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound({ packetsLost: 2 })));
    const recovered = sampler.sample(videoReport(inbound({ timestamp: 2_000,
      packetsReceived: 200, packetsLost: -1, framesDecoded: 89,
    })));
    expect(recovered.lossRatio).toBe(0);
    const reset = sampler.sample(videoReport(inbound({ timestamp: 3_000,
      packetsReceived: 1, packetsLost: 0, framesDecoded: 1,
    })));
    expect(reset.lossRatio).toBeNull();
  });

  it("clears its history when inbound video disappears", () => {
    const sampler = new VideoStatsSampler();
    sampler.sample(videoReport(inbound()));
    expect(sampler.sample(report()).width).toBeNull();
    expect(sampler.sample(videoReport(inbound({ timestamp: 2_000 }))).fps).toBeNull();
  });
});

describe("AdaptiveVideoPolicy", () => {
  it("requires sustained bad evidence and ignores a brief spike", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p60");
    warm(policy);
    expect(policy.observe(bad, 3_000)).toBeNull();
    expect(policy.observe(good, 4_000)).toBeNull();
    expect(policy.observe(bad, 5_000)).toBeNull();
    expect(policy.observe(bad, 6_000)).toBeNull();
    expect(policy.observe(bad, 7_000)).toBe("720p30");
  });

  it.each([
    { jitterMs: 70 }, { lossRatio: 0.1 }, { jitterBufferMs: 180 },
    { fps: 0, stalled: true },
  ])("can step down for sustained video impairment %j", (impairment) => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p30");
    warm(policy);
    const stats = { ...good, ...impairment };
    expect(policy.observe(stats, 3_000)).toBeNull();
    expect(policy.observe(stats, 4_000)).toBeNull();
    expect(policy.observe(stats, 5_000)).toBe("540p30");
  });

  it("waits for acknowledgement and cools down before another change", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p60");
    warm(policy);
    policy.observe(bad, 3_000);
    policy.observe(bad, 4_000);
    expect(policy.observe(bad, 5_000)).toBe("720p30");
    expect(policy.observe(bad, 6_000)).toBeNull();
    policy.acknowledge("720p30", 6_000);
    for (let now = 7_000; now < 14_000; now += 1_000) {
      expect(policy.observe(bad, now)).toBeNull();
    }
    expect(policy.observe(bad, 14_000)).toBeNull();
    expect(policy.observe(bad, 15_000)).toBeNull();
    expect(policy.observe(bad, 16_000)).toBe("540p30");
  });

  it("retries the same target after a missing acknowledgement instead of assuming success", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p60");
    warm(policy);
    policy.observe(bad, 3_000);
    policy.observe(bad, 4_000);
    expect(policy.observe(bad, 5_000)).toBe("720p30");
    for (let now = 6_000; now <= 11_000; now += 1_000) {
      expect(policy.observe(bad, now)).toBeNull();
    }
    expect(policy.observe(bad, 12_000)).toBe("720p30");
  });

  it("bounds retries when the sender never acknowledges", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p60");
    const changes: string[] = [];
    for (let now = 0; now <= 90_000; now += 1_000) {
      const next = policy.observe(bad, now);
      if (next) changes.push(next);
    }
    expect(changes).toEqual(["720p30", "720p30", "720p30"]);
  });

  it("never steps below 360p, and uses only supported profiles", () => {
    const minimum = new AdaptiveVideoPolicy(profiles, "360p30");
    const limited = new AdaptiveVideoPolicy(["720p30", "360p30"], "720p30");
    warm(minimum);
    warm(limited);
    for (const now of [3_000, 4_000]) {
      expect(minimum.observe(bad, now)).toBeNull();
      expect(limited.observe(bad, now)).toBeNull();
    }
    expect(minimum.observe(bad, 5_000)).toBeNull();
    expect(limited.observe(bad, 5_000)).toBe("360p30");
  });

  it("recovers only one level after six seconds of continuous good evidence", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    warm(policy);
    for (let now = 3_000; now < 9_000; now += 1_000) {
      expect(policy.observe(good, now)).toBeNull();
    }
    expect(policy.observe(good, 9_000)).toBe("540p30");
  });

  it.each(["rttMs", "jitterMs", "lossRatio", "fps"] as const)(
    "does not upgrade when %s is unknown", (field) => {
      const policy = new AdaptiveVideoPolicy(profiles, "360p30");
      for (let now = 0; now <= 30_000; now += 1_000) {
        expect(policy.observe({ ...good, [field]: null }, now)).toBeNull();
      }
    },
  );

  it("allows recovery without optional jitter-buffer stats and does not punish low FPS alone", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    const stats = { ...good, fps: 12, jitterBufferMs: null };
    for (let now = 0; now < 9_000; now += 1_000) {
      expect(policy.observe(stats, now)).toBeNull();
    }
    expect(policy.observe(stats, 9_000)).toBe("540p30");
  });

  it("resets good history across a background gap", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    for (let now = 0; now <= 8_000; now += 1_000) policy.observe(good, now);
    expect(policy.observe(good, 40_000)).toBeNull();
    for (let now = 41_000; now < 49_000; now += 1_000) {
      expect(policy.observe(good, now)).toBeNull();
    }
    expect(policy.observe(good, 49_000)).toBe("540p30");
  });

  it("restarts the six-second recovery window after an unknown observation", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "360p30");
    warm(policy);
    for (let now = 3_000; now <= 7_000; now += 1_000) {
      expect(policy.observe(good, now)).toBeNull();
    }
    expect(policy.observe({ ...good, lossRatio: null }, 8_000)).toBeNull();
    for (let now = 9_000; now < 15_000; now += 1_000) {
      expect(policy.observe(good, now)).toBeNull();
    }
    expect(policy.observe(good, 15_000)).toBe("540p30");
  });

  it("does not count burst observations as seconds of sustained impairment", () => {
    const policy = new AdaptiveVideoPolicy(profiles, "720p60");
    warm(policy);
    expect(policy.observe(bad, 3_000)).toBeNull();
    expect(policy.observe(bad, 3_100)).toBeNull();
    expect(policy.observe(bad, 3_200)).toBeNull();
    expect(policy.observe(bad, 4_000)).toBeNull();
    expect(policy.observe(bad, 5_000)).toBe("720p30");
  });
});

describe("formatVideoStreamStats", () => {
  it("displays measured stream dimensions and rounded decoded FPS", () => {
    expect(formatVideoStreamStats({ width: 1280, height: 720, fps: 28.7 }))
      .toBe("1280×720 · 29 FPS");
    expect(formatVideoStreamStats({ width: 640, height: 360, fps: 0 }))
      .toBe("640×360 · 0 FPS");
  });

  it("keeps missing or invalid measurements visibly unknown", () => {
    expect(formatVideoStreamStats({ width: 640, height: 360, fps: null }))
      .toBe("640×360 · — FPS");
    expect(formatVideoStreamStats({ width: null, height: null, fps: null }))
      .toBe("VIDEO · —");
    expect(formatVideoStreamStats({ width: 0, height: 720, fps: Number.NaN }))
      .toBe("VIDEO · —");
  });
});
