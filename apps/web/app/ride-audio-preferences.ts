export type AudioPreferences = {
  accountId: string;
  volumePercent: number;
  muted: boolean;
  revision: number;
};
export type StoredAudioPreferences = Omit<AudioPreferences, "accountId">;

export type PlaybackPreferences = { volume: number; muted: boolean };
export type AudioSaveStatus = "loading" | "saved" | "saving" | "not-saved";
export const PENDING_AUDIO_PREFERENCES: PlaybackPreferences = { volume: 0, muted: true };

const endpoint = "/api/account/audio-preferences";
const saveDelayMs = 300;
const requestTimeoutMs = 4000;

export function isAudioPreferences(value: unknown): value is AudioPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AudioPreferences>;
  return typeof candidate.accountId === "string" && candidate.accountId.length > 0
    && typeof candidate.volumePercent === "number"
    && Number.isInteger(candidate.volumePercent)
    && candidate.volumePercent >= 0 && candidate.volumePercent <= 100
    && typeof candidate.muted === "boolean"
    && typeof candidate.revision === "number"
    && Number.isSafeInteger(candidate.revision) && candidate.revision >= 0;
}

/** Account-scoped persistence runs independently of video and car controls. */
export class RideAudioPreferences {
  #value = { ...PENDING_AUDIO_PREFERENCES };
  #revision: number | null = null;
  #accountId: string | null = null;
  #edited = false;
  #dirty = false;
  #saving = false;
  #closed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #loading: Promise<void> | null = null;

  constructor(
    private readonly onValue: (value: PlaybackPreferences) => void,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onStatus: (status: AudioSaveStatus) => void = () => {},
  ) {}

  get value(): PlaybackPreferences { return { ...this.#value }; }

  load(): Promise<void> {
    this.#loading ??= this.#load().finally(() => { this.#loading = null; });
    return this.#loading;
  }

  async #load(): Promise<void> {
    try {
      const { response, preferences } = await this.#request({ cache: "no-store" });
      if (!response.ok || !isAudioPreferences(preferences)) throw new Error("Preferences unavailable");
      if (this.#accountId !== null && this.#accountId !== preferences.accountId) {
        this.#dirty = false;
        this.#edited = false;
      }
      this.#accountId = preferences.accountId;
      this.#revision = preferences.revision;
      // The account fetch may finish after the driver has already touched a control.
      if (!this.#edited && !this.#closed) {
        this.#value = { volume: preferences.volumePercent / 100, muted: preferences.muted };
        this.onValue(this.value);
      }
      if (this.#dirty) this.flush();
      else this.#status("saved");
    } catch {
      this.#status("not-saved");
    }
  }

  update(value: PlaybackPreferences): void {
    if (this.#closed || !Number.isFinite(value.volume)) return;
    this.#value = { volume: Math.round(Math.max(0, Math.min(1, value.volume)) * 100) / 100, muted: value.muted };
    this.#edited = true;
    this.#dirty = true;
    this.onValue(this.value);
    this.#status("saving");
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#revision === null) void this.load();
      else this.flush();
    }, saveDelayMs);
  }

  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#dirty && this.#revision !== null && !this.#saving) void this.#save();
  }

  close(): void {
    this.#closed = true;
    // A short keepalive request preserves the final slider position on navigation.
    // Do not abort an in-flight write: an aborted HTTP request can still commit.
    this.flush();
  }

  async #save(): Promise<void> {
    this.#saving = true;
    let conflicts = 0;
    try {
      while (this.#dirty && this.#revision !== null && this.#accountId !== null) {
        this.#dirty = false;
        const body: AudioPreferences = {
          accountId: this.#accountId,
          volumePercent: Math.round(this.#value.volume * 100),
          muted: this.#value.muted,
          revision: this.#revision,
        };
        const { response, preferences } = await this.#request({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
        });
        if (!isAudioPreferences(preferences)) throw new Error("Invalid preferences response");
        if (preferences.accountId !== this.#accountId) throw new Error("Account changed");
        if (response.status === 409) {
          this.#revision = preferences.revision;
          // A departed screen must not overwrite a newer tab/session's choice.
          if (this.#closed || ++conflicts > 2) throw new Error("Preferences changed elsewhere");
          this.#dirty = true;
          continue;
        }
        if (!response.ok) throw new Error("Could not save preferences");
        this.#revision = preferences.revision;
        // Never apply a save response to playback: it can describe an older edit.
      }
      this.#status("saved");
    } catch {
      this.#dirty = true;
      this.#status("not-saved");
    } finally {
      this.#saving = false;
    }
  }

  async #request(init: RequestInit): Promise<{ response: Response; preferences: unknown }> {
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Audio preferences request timed out"));
      }, requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.fetcher(endpoint, { ...init, credentials: "same-origin", signal: controller.signal })
          .then(async (response) => ({ response, preferences: await response.json() as unknown })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #status(status: AudioSaveStatus): void {
    if (!this.#closed) this.onStatus(status);
  }
}
