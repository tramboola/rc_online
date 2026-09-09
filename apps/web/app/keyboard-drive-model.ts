import {
  controlIntentFromPressedKeys,
  type KeyboardControlIntent,
} from "./keyboard-control";

export type KeyboardDriveOutput = {
  steering: number;
  throttle: number;
  nitro: boolean;
};

export class KeyboardDriveModel {
  private intent: KeyboardControlIntent = { steering: 0, throttle: 0, nitro: false };
  private forwardStartedAt: number | null = null;
  private reverseStartedAt: number | null = null;
  private turnStartedAt: number | null = null;
  private turnDurationMs = 0;
  private lastNowMs = 0;

  update(pressed: ReadonlySet<string>, nowMs: number): KeyboardDriveOutput {
    nowMs = this.advanceClock(nowMs);
    const next = controlIntentFromPressedKeys(pressed);
    if (next.throttle !== 1) this.forwardStartedAt = null;
    else if (this.intent.throttle !== 1) this.forwardStartedAt = nowMs;
    if (next.throttle !== -1) this.reverseStartedAt = null;
    else if (this.intent.throttle !== -1) this.reverseStartedAt = nowMs;

    if (next.steering !== this.intent.steering) {
      this.turnStartedAt = next.steering === 0 ? null : nowMs;
      // Capture Nitro at turn start; later N changes keep this ramp continuous.
      const fullTurnDurationMs = next.nitro ? 600 : 450;
      this.turnDurationMs = this.forwardStartedAt === null
        ? 0
        : fullTurnDurationMs * Math.min(1, Math.max(0, (nowMs - this.forwardStartedAt) / 1_000));
    } else if (next.throttle !== 1) {
      // Once gas is released, the held turn stays full even if gas returns.
      this.turnDurationMs = 0;
    }

    this.intent = next;
    return this.sample(nowMs);
  }

  sample(nowMs: number): KeyboardDriveOutput {
    nowMs = this.advanceClock(nowMs);
    const throttle = this.reverseStartedAt !== null && nowMs - this.reverseStartedAt >= 500
      ? -0.4
      : this.intent.throttle;
    const turnProgress = this.turnStartedAt !== null && this.turnDurationMs > 0
      ? Math.min(1, Math.max(0, (nowMs - this.turnStartedAt) / this.turnDurationMs))
      : 1;
    const steering = turnProgress === 0 ? 0 : this.intent.steering * turnProgress;

    return { steering, throttle, nitro: this.intent.nitro };
  }

  reset(): void {
    this.intent = { steering: 0, throttle: 0, nitro: false };
    this.forwardStartedAt = null;
    this.reverseStartedAt = null;
    this.turnStartedAt = null;
    this.turnDurationMs = 0;
    this.lastNowMs = 0;
  }

  private advanceClock(nowMs: number): number {
    if (Number.isFinite(nowMs)) this.lastNowMs = Math.max(this.lastNowMs, nowMs);
    return this.lastNowMs;
  }
}
