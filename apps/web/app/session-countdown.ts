export function remainingSessionSeconds(expiresAt: string, now: Date): number {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return 0;
  return Math.max(0, Math.ceil((expiryMs - now.getTime()) / 1000));
}

export function formatSessionTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

type CountdownHandle = unknown;

type SessionCountdownOptions = {
  onTick(seconds: number): void;
  onExpire(): void;
  now?: () => Date;
  schedule?: (callback: () => void, intervalMs: number) => CountdownHandle;
  cancel?: (handle: CountdownHandle) => void;
};

export class SessionCountdown {
  readonly #onTick: (seconds: number) => void;
  readonly #onExpire: () => void;
  readonly #now: () => Date;
  readonly #schedule: (callback: () => void, intervalMs: number) => CountdownHandle;
  readonly #cancel: (handle: CountdownHandle) => void;
  #expiresAt = "";
  #handle: CountdownHandle | null = null;
  #expired = false;

  constructor(options: SessionCountdownOptions) {
    this.#onTick = options.onTick;
    this.#onExpire = options.onExpire;
    this.#now = options.now ?? (() => new Date());
    this.#schedule = options.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.#cancel = options.cancel ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  start(expiresAt: string): void {
    this.stop();
    this.#expiresAt = expiresAt;
    this.#expired = false;
    this.#tick();
    if (!this.#expired) this.#handle = this.#schedule(() => this.#tick(), 250);
  }

  stop(): void {
    if (this.#handle !== null) {
      this.#cancel(this.#handle);
      this.#handle = null;
    }
  }

  #tick(): void {
    const remaining = remainingSessionSeconds(this.#expiresAt, this.#now());
    this.#onTick(remaining);
    if (remaining > 0 || this.#expired) return;
    this.#expired = true;
    this.stop();
    this.#onExpire();
  }
}
