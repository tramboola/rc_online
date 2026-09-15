export type RideAudioState = {
  hasAudio: boolean;
  muted: boolean;
  volume: number;
  blocked: boolean;
};

export const INITIAL_RIDE_AUDIO: RideAudioState = {
  hasAudio: false,
  muted: false,
  volume: 1,
  blocked: false,
};

/** Plays the combined onboard stream without letting audio autoplay block driving. */
export class RideMediaPlayback {
  readonly #video: HTMLVideoElement;
  readonly #onState: (state: RideAudioState) => void;
  readonly #onError: (message: string) => void;
  #state = { ...INITIAL_RIDE_AUDIO };
  #generation = 0;
  #closed = false;

  constructor(
    video: HTMLVideoElement,
    onState: (state: RideAudioState) => void,
    onError: (message: string) => void,
  ) {
    this.#video = video;
    this.#onState = onState;
    this.#onError = onError;
  }

  async attach(stream: MediaStream): Promise<void> {
    if (this.#closed) return;
    if (this.#video.srcObject !== stream) this.#video.srcObject = stream;
    this.#state.hasAudio = stream.getAudioTracks().length > 0;
    this.#publish();
    await this.#play();
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.#closed) return;
    this.#state.muted = muted;
    this.#state.blocked = false;
    this.#publish();
    await this.#play();
  }

  setVolume(volume: number): void {
    if (this.#closed || !Number.isFinite(volume)) return;
    this.#state.volume = Math.max(0, Math.min(1, volume));
    this.#video.volume = this.#state.volume;
    this.#publish();
  }

  async resumeFromGesture(): Promise<void> {
    if (this.#closed || !this.#state.blocked || this.#state.muted) return;
    this.#state.blocked = false;
    await this.#play();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation += 1;
    this.#video.pause();
    this.#video.srcObject = null;
  }

  async #play(): Promise<void> {
    const generation = ++this.#generation;
    this.#video.muted = this.#state.muted || this.#state.blocked;
    this.#video.volume = this.#state.volume;
    if (!this.#video.srcObject) return;
    try {
      await this.#video.play();
      if (this.#current(generation)) this.#publish();
    } catch (error) {
      if (!this.#current(generation)) return;
      if (!this.#video.muted && this.#state.hasAudio &&
          error instanceof Error && error.name === "NotAllowedError") {
        this.#state.blocked = true;
        this.#video.muted = true;
        this.#publish();
        try {
          await this.#video.play();
        } catch {
          if (this.#current(generation)) this.#onError("Browser could not start the camera video");
        }
        return;
      }
      this.#onError("Browser could not start the camera video");
    }
  }

  #current(generation: number): boolean {
    return !this.#closed && generation === this.#generation;
  }

  #publish(): void {
    this.#onState({ ...this.#state });
  }
}
