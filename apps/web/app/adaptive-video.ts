export type VideoProfile = "720p60" | "720p30" | "540p30" | "360p30";

export type VideoStreamStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  lossRatio: number | null;
  jitterBufferMs: number | null;
  stalled: boolean;
};

type StatsEntry = Record<string, unknown>;
type VideoSample = {
  identity: string;
  timestamp: number | null;
  frames: number | null;
  received: number | null;
  lost: number | null;
  bytes: number | null;
  bufferDelay: number | null;
  bufferEmitted: number | null;
};

const PROFILE_ORDER: readonly VideoProfile[] = ["720p60", "720p30", "540p30", "360p30"];
const PROFILE_HEIGHT: Record<VideoProfile, number> = {
  "720p60": 720, "720p30": 720, "540p30": 540, "360p30": 360,
};
const MIN_HEALTHY_FPS = 21;
const MAX_SAMPLE_GAP_MS = 3_000;

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function dimension(value: unknown): number | null {
  const number = nonNegative(value);
  return number !== null && number > 0 && Number.isInteger(number) ? number : null;
}

function milliseconds(value: unknown): number | null {
  const seconds = nonNegative(value);
  return seconds === null ? null : nonNegative(seconds * 1_000);
}

function delta(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null && current >= previous ? current - previous : null;
}

function snapshot(entry: StatsEntry): VideoSample {
  return {
    identity: [entry.id, entry.ssrc, entry.trackIdentifier, entry.codecId].join(":"),
    timestamp: nonNegative(entry.timestamp),
    frames: nonNegative(entry.framesDecoded),
    received: nonNegative(entry.packetsReceived),
    // RFC 3550's cumulative estimate is signed: duplicate/recovered packets can lower it.
    lost: typeof entry.packetsLost === "number" && Number.isFinite(entry.packetsLost)
      ? entry.packetsLost : null,
    bytes: nonNegative(entry.bytesReceived),
    bufferDelay: nonNegative(entry.jitterBufferDelay),
    bufferEmitted: nonNegative(entry.jitterBufferEmittedCount),
  };
}

function emptyStats(): VideoStreamStats {
  return { width: null, height: null, fps: null, rttMs: null, jitterMs: null,
    lossRatio: null, jitterBufferMs: null, stalled: false };
}

function selectedPair(entries: Map<string, StatsEntry>, video: StatsEntry): StatsEntry | undefined {
  const transport = typeof video.transportId === "string" ? entries.get(video.transportId) : undefined;
  if (typeof transport?.selectedCandidatePairId === "string") {
    return entries.get(transport.selectedCandidatePairId);
  }
  // Some Safari versions omit the transport report. Only use an unambiguous pair.
  const transports = [...entries.values()].filter((entry) => entry.type === "transport"
    && typeof entry.selectedCandidatePairId === "string");
  const onlyTransport = transports.length === 1 ? transports[0] : undefined;
  if (!video.transportId && onlyTransport) {
    return entries.get(onlyTransport.selectedCandidatePairId as string);
  }
  const pairs = [...entries.values()].filter((entry) => entry.type === "candidate-pair"
    && entry.state === "succeeded"
    && (!entry.transportId || !video.transportId || entry.transportId === video.transportId));
  const selected = pairs.filter((entry) => entry.selected === true);
  if (selected.length === 1) return selected[0];
  const nominated = pairs.filter((entry) => entry.nominated === true);
  return nominated.length === 1 ? nominated[0] : undefined;
}

/** Reads receiver measurements, not the configured camera target or end-to-end latency. */
export class VideoStatsSampler {
  private previous: VideoSample | null = null;
  private candidates = new Map<string, VideoSample>();

  sample(report: RTCStatsReport): VideoStreamStats {
    const entries = new Map<string, StatsEntry>();
    report.forEach((entry) => {
      if (typeof entry.id === "string") entries.set(entry.id, entry as StatsEntry);
    });
    const videos = [...entries.values()].filter((entry) => {
      if (entry.type !== "inbound-rtp" || entry.isRemote === true || entry.active === false
        || (entry.kind !== "video" && entry.mediaType !== "video")) return false;
      const codec = typeof entry.codecId === "string" ? entries.get(entry.codecId) : undefined;
      return typeof codec?.mimeType !== "string" || !/\/(?:rtx|red|ulpfec|flexfec(?:-03)?)$/i.test(codec.mimeType);
    });
    const activity = (entry: StatsEntry): number => {
      const current = snapshot(entry);
      const prior = this.candidates.get(current.identity);
      if (prior && current.timestamp !== null && prior.timestamp !== null
        && current.timestamp > prior.timestamp) {
        if ((delta(current.frames, prior.frames) ?? 0) > 0) return 3;
        if ((delta(current.bytes, prior.bytes) ?? 0) > 0
          || (delta(current.received, prior.received) ?? 0) > 0) return 2;
      }
      return (nonNegative(entry.framesPerSecond) ?? 0) > 0 ? 1 : 0;
    };
    videos.sort((left, right) => activity(right) - activity(left)
      || Number(snapshot(right).identity === this.previous?.identity)
        - Number(snapshot(left).identity === this.previous?.identity)
      || Number(dimension(right.frameWidth) !== null) - Number(dimension(left.frameWidth) !== null)
      || (nonNegative(right.framesDecoded) ?? 0) - (nonNegative(left.framesDecoded) ?? 0));
    this.candidates = new Map(videos.map((video) => {
      const sample = snapshot(video);
      return [sample.identity, sample];
    }));
    const video = videos[0];
    if (!video) {
      this.previous = null;
      return emptyStats();
    }

    const current = snapshot(video);
    const previous = this.previous?.identity === current.identity ? this.previous : null;
    const elapsed = previous?.timestamp !== null && previous?.timestamp !== undefined && current.timestamp !== null
      ? current.timestamp - previous.timestamp : null;
    const reset = previous !== null && (
      (current.frames !== null && previous.frames !== null && current.frames < previous.frames)
      || (current.received !== null && previous.received !== null && current.received < previous.received)
      || (current.bytes !== null && previous.bytes !== null && current.bytes < previous.bytes));
    const comparable = previous !== null && elapsed !== null && elapsed >= 100
      && elapsed <= MAX_SAMPLE_GAP_MS && !reset;
    const stale = previous !== null && (elapsed === null || elapsed < 100 || elapsed > MAX_SAMPLE_GAP_MS);
    this.previous = current;
    const result = emptyStats();
    result.width = dimension(video.frameWidth);
    result.height = dimension(video.frameHeight);

    if (!stale) {
      const pair = selectedPair(entries, video);
      result.rttMs = pair?.responsesReceived === 0 ? null : milliseconds(pair?.currentRoundTripTime);
      result.jitterMs = milliseconds(video.jitter);
    }
    if (comparable && previous && elapsed !== null) {
      const frames = delta(current.frames, previous.frames);
      if (frames !== null) {
        result.fps = nonNegative(frames * 1_000 / elapsed);
        result.stalled = frames === 0;
      } else if (current.frames === null || previous.frames === null) {
        result.fps = nonNegative(video.framesPerSecond);
        result.stalled = result.fps === 0;
      }
      const received = delta(current.received, previous.received);
      const lost = current.lost !== null && previous.lost !== null
        ? nonNegative(Math.max(0, current.lost - previous.lost)) : null;
      if (received !== null && lost !== null && received + lost > 0) {
        result.lossRatio = lost / (received + lost);
      }
      const delay = delta(current.bufferDelay, previous.bufferDelay);
      const emitted = delta(current.bufferEmitted, previous.bufferEmitted);
      if (delay !== null && emitted !== null && emitted > 0) {
        result.jitterBufferMs = nonNegative(delay * 1_000 / emitted);
      }
    } else if (previous === null) {
      result.fps = nonNegative(video.framesPerSecond);
      // A first zero-FPS report can precede the first frame; wait for an interval.
    }
    return result;
  }
}

/** Hysteresis for discrete camera profiles. The sender must acknowledge every change. */
export class AdaptiveVideoPolicy {
  private readonly profiles: readonly VideoProfile[];
  private current: VideoProfile;
  private firstSampleAt: number | null = null;
  private lastSampleAt: number | null = null;
  private lastChangeAt: number | null = null;
  private badSamples = 0;
  private lowFpsSamples = 0;
  private goodSince: number | null = null;
  private pending: { profile: VideoProfile; requestedAt: number } | null = null;
  private unacknowledgedRequests = 0;

  constructor(profiles: readonly VideoProfile[], current: VideoProfile) {
    this.profiles = PROFILE_ORDER.filter((profile) => profiles.includes(profile));
    if (!this.profiles.includes(current)) throw new Error("Current video profile must be supported");
    this.current = current;
  }

  private clearEvidence(): void {
    this.badSamples = 0;
    this.lowFpsSamples = 0;
    this.goodSince = null;
  }

  observe(stats: VideoStreamStats, nowMs: number): VideoProfile | null {
    if (!Number.isFinite(nowMs) || nowMs < 0) return null;
    const gap = this.lastSampleAt === null ? null : nowMs - this.lastSampleAt;
    if (gap !== null && gap > 0 && gap < 750) return null;
    if (gap === null || gap <= 0 || gap > MAX_SAMPLE_GAP_MS) {
      this.firstSampleAt = nowMs;
      this.clearEvidence();
    }
    this.lastSampleAt = nowMs;
    if (this.pending) {
      if (nowMs - this.pending.requestedAt < 5_000) return null;
      this.pending = null;
      this.clearEvidence();
    }
    if (this.firstSampleAt === null || nowMs - this.firstSampleAt < 3_000
      || (this.lastChangeAt !== null && nowMs - this.lastChangeAt < 8_000)) {
      this.clearEvidence();
      return null;
    }
    const rtt = nonNegative(stats.rttMs);
    const jitter = nonNegative(stats.jitterMs);
    const loss = nonNegative(stats.lossRatio);
    const buffer = nonNegative(stats.jitterBufferMs);
    const fps = nonNegative(stats.fps);
    const lowFps = fps !== null && fps < MIN_HEALTHY_FPS;
    this.lowFpsSamples = lowFps ? this.lowFpsSamples + 1 : 0;
    const impaired = lowFps || stats.stalled || (rtt !== null && rtt > 250)
      || (jitter !== null && jitter > 50) || (loss !== null && loss <= 1 && loss > 0.05)
      || (buffer !== null && buffer > 150);
    const healthy = !impaired && fps !== null && fps >= MIN_HEALTHY_FPS
      && rtt !== null && rtt < 160 && jitter !== null && jitter < 25
      && loss !== null && loss < 0.01
      && (stats.jitterBufferMs === null || (buffer !== null && buffer < 80));

    if (impaired) {
      this.badSamples += 1;
      this.goodSince = null;
    } else {
      this.badSamples = 0;
      this.goodSince = healthy ? (this.goodSince ?? nowMs) : null;
    }
    const currentIndex = this.profiles.indexOf(this.current);
    let next: VideoProfile | undefined;
    if (this.lowFpsSamples >= 3) {
      // Sustained low FPS needs fewer pixels, not just a lower target frame rate.
      // Skip 720p30 from 720p60, but never request a profile the Pi did not offer.
      next = this.profiles.slice(currentIndex + 1)
        .find((profile) => PROFILE_HEIGHT[profile] < PROFILE_HEIGHT[this.current])
        ?? this.profiles[currentIndex + 1];
    } else if (this.badSamples >= 3) next = this.profiles[currentIndex + 1];
    else if (this.goodSince !== null && nowMs - this.goodSince >= 6_000) {
      next = this.profiles[currentIndex - 1];
    }
    if (!next || this.unacknowledgedRequests >= 3) return null;
    this.pending = { profile: next, requestedAt: nowMs };
    this.unacknowledgedRequests += 1;
    this.clearEvidence();
    return next;
  }

  acknowledge(profile: VideoProfile, nowMs: number): void {
    if (!this.profiles.includes(profile) || !Number.isFinite(nowMs) || nowMs < 0) return;
    this.current = profile;
    this.pending = null;
    this.unacknowledgedRequests = 0;
    this.lastChangeAt = nowMs;
    this.clearEvidence();
  }
}

export function formatVideoStreamStats(stats: Pick<VideoStreamStats, "width" | "height" | "fps">): string {
  const width = dimension(stats.width);
  const height = dimension(stats.height);
  if (width === null || height === null) return "VIDEO · —";
  const fps = nonNegative(stats.fps);
  return `${width}×${height} · ${fps === null ? "—" : Math.round(fps)} FPS`;
}
