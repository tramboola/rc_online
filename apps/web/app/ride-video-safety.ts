export const VIDEO_FREEZE_TIMEOUT_MS = 1_000;
const VIDEO_PROGRESS_POLL_MS = 100;

/**
 * Observes local presentation/decoding progress, not camera-to-screen latency.
 * Recovery only reports freshness: the owner must explicitly resume controls.
 */
export class RideVideoSafety {
  readonly #video: HTMLVideoElement;
  readonly #onFreshness: (fresh: boolean) => void;
  #stream: MediaStream | null = null;
  #generation = 0;
  #closed = false;
  #fresh = false;
  #lastFrameAt: number | null = null;
  #lastFrameCount: number | null = null;
  #lastPresentedFrames: number | null = null;
  #lastMediaTime = 0;
  #frameCallback: number | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #freezeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(video: HTMLVideoElement, onFreshness: (fresh: boolean) => void) {
    this.#video = video;
    this.#onFreshness = onFreshness;
    for (const event of ["pause", "ended", "emptied", "loadeddata"]) {
      video.addEventListener(event, this.check);
    }
    document.addEventListener("visibilitychange", this.check);
  }

  watch(stream: MediaStream): void {
    if (this.#closed || this.#stream === stream) return;
    this.#cancelWatch();
    this.#stream = stream;
    this.#lastFrameAt = null;
    this.#lastPresentedFrames = null;
    this.#resetFallbackBaseline();
    const generation = this.#generation;
    this.#publish(false);
    if (this.#closed || generation !== this.#generation) return;
    this.#requestFrame(generation);
    this.#pollTimer = setInterval(this.check, VIDEO_PROGRESS_POLL_MS);
  }

  isFresh(): boolean {
    return !this.#closed && this.#ready() && this.#lastFrameAt !== null
      && performance.now() - this.#lastFrameAt < VIDEO_FREEZE_TIMEOUT_MS;
  }

  readonly check = (): void => {
    if (this.#closed || !this.#stream) return;
    if (!this.#ready()) {
      // Hidden/paused media must present a new frame before it is usable again.
      this.#lastFrameAt = null;
      this.#resetFallbackBaseline();
    } else if (typeof this.#video.requestVideoFrameCallback !== "function") {
      const count = this.#frameCount();
      const mediaTime = this.#video.currentTime;
      const progressed = count === null
        ? Number.isFinite(mediaTime) && mediaTime > this.#lastMediaTime
        : this.#lastFrameCount !== null && count > this.#lastFrameCount;
      this.#lastFrameCount = count;
      this.#lastMediaTime = mediaTime;
      if (progressed) this.#noteFrame();
    }
    this.#publish(this.isFresh());
  };

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelWatch();
    this.#stream = null;
    for (const event of ["pause", "ended", "emptied", "loadeddata"]) {
      this.#video.removeEventListener(event, this.check);
    }
    document.removeEventListener("visibilitychange", this.check);
  }

  #ready(): boolean {
    return this.#stream !== null && this.#video.srcObject === this.#stream
      && document.visibilityState === "visible" && this.#video.readyState >= 2
      && !this.#video.paused && !this.#video.ended
      && this.#video.videoWidth > 0 && this.#video.videoHeight > 0;
  }

  #requestFrame(generation: number): void {
    if (this.#closed || generation !== this.#generation
      || typeof this.#video.requestVideoFrameCallback !== "function") return;
    this.#frameCallback = this.#video.requestVideoFrameCallback((_now, metadata) => {
      if (this.#closed || generation !== this.#generation) return;
      this.#frameCallback = null;
      if (this.#ready() && (this.#lastPresentedFrames === null
        || metadata.presentedFrames > this.#lastPresentedFrames)) {
        this.#noteFrame();
      }
      this.#lastPresentedFrames = metadata.presentedFrames;
      this.#publish(this.isFresh());
      this.#requestFrame(generation);
    });
  }

  #noteFrame(): void {
    this.#lastFrameAt = performance.now();
    if (this.#freezeTimer !== null) clearTimeout(this.#freezeTimer);
    this.#freezeTimer = setTimeout(this.check, VIDEO_FREEZE_TIMEOUT_MS);
  }

  #frameCount(): number | null {
    if (typeof this.#video.getVideoPlaybackQuality === "function") {
      const quality = this.#video.getVideoPlaybackQuality();
      const displayed = quality.totalVideoFrames - quality.droppedVideoFrames;
      if (Number.isFinite(displayed) && displayed >= 0) return displayed;
    }
    const decoded = (this.#video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
    return typeof decoded === "number" && Number.isFinite(decoded) && decoded >= 0 ? decoded : null;
  }

  #resetFallbackBaseline(): void {
    this.#lastFrameCount = this.#frameCount();
    this.#lastMediaTime = this.#video.currentTime;
  }

  #publish(fresh: boolean): void {
    if (this.#fresh === fresh) return;
    this.#fresh = fresh;
    this.#onFreshness(fresh);
  }

  #cancelWatch(): void {
    this.#generation += 1;
    if (this.#frameCallback !== null) this.#video.cancelVideoFrameCallback?.(this.#frameCallback);
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    if (this.#freezeTimer !== null) clearTimeout(this.#freezeTimer);
    this.#frameCallback = null;
    this.#pollTimer = null;
    this.#freezeTimer = null;
  }
}
