export interface ControlInput {
  readonly rideId: string;
  readonly sequence: number;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
  readonly receivedMonotonicMs: number;
}

export interface SafetyDecision {
  readonly accepted: boolean;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
  readonly reason: string;
}

export class EdgeSafetyGate {
  #operatorStop = false;
  #activeRideId: string | null = null;
  #lastSequence = -1;

  public activateRide(rideId: string): void {
    this.#activeRideId = rideId;
    this.#lastSequence = -1;
    this.#operatorStop = false;
  }

  public stop(reason: string): SafetyDecision {
    this.#operatorStop = true;
    return {
      accepted: false,
      steering: 0,
      throttle: 0,
      brake: 1000,
      reason: `operator_stop:${reason}`,
    };
  }

  public apply(input: ControlInput, nowMonotonicMs: number): SafetyDecision {
    if (this.#operatorStop) {
      return this.stop("latched");
    }
    if (input.rideId !== this.#activeRideId) {
      return this.neutral("ride_mismatch");
    }
    if (input.sequence <= this.#lastSequence) {
      return this.neutral("stale_or_replayed_sequence");
    }
    if (nowMonotonicMs - input.receivedMonotonicMs > 100) {
      return this.neutral("stale_command");
    }
    this.#lastSequence = input.sequence;
    return {
      accepted: true,
      steering: Math.max(-1000, Math.min(1000, input.steering)),
      throttle: Math.max(0, Math.min(1000, input.throttle)),
      brake: Math.max(0, Math.min(1000, input.brake)),
      reason: "accepted",
    };
  }

  private neutral(reason: string): SafetyDecision {
    return {
      accepted: false,
      steering: 0,
      throttle: 0,
      brake: 1000,
      reason,
    };
  }
}
