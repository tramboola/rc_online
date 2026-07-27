import type { RideSnapshot } from "@rc/contracts";

import { createRideStateMachine } from "./state-machine.js";

export interface RideOrchestratorInput {
  readonly id: string;
  readonly userId: string;
  readonly carId: string;
  readonly purchasedSeconds: number;
}

export class RideOrchestrator {
  readonly #machine;
  readonly #input: RideOrchestratorInput;
  #attemptCount = 0;
  #usedSeconds = 0;
  #startedAt: Date | null = null;

  public constructor(input: RideOrchestratorInput) {
    if (input.purchasedSeconds < 300) {
      throw new Error("A ride requires at least five minutes");
    }
    this.#input = input;
    this.#machine = createRideStateMachine(input.id);
  }

  public offer(key: string, at: Date): void {
    this.#machine.transition({
      to: "OFFERED",
      reason: "fifo_offer",
      initiator: "system",
      idempotencyKey: key,
      occurredAt: at,
    });
  }

  public accept(key: string, at: Date): void {
    this.#machine.transition({
      to: "ACCEPTED",
      reason: "user_accepted_offer",
      initiator: "user",
      idempotencyKey: key,
      occurredAt: at,
    });
  }

  public negotiationStarted(key: string, at: Date): void {
    if (this.#machine.state === "ACCEPTED") {
      this.#machine.transition({
        to: "NEGOTIATING",
        reason: "webrtc_negotiation_started",
        initiator: "system",
        idempotencyKey: key,
        occurredAt: at,
      });
      this.#startedAt = at;
    }
    if (this.#machine.state !== "NEGOTIATING") {
      throw new Error("Ride is not ready for WebRTC negotiation");
    }
    if (this.#attemptCount >= 5) {
      throw new Error("Maximum WebRTC attempts reached");
    }
    this.#attemptCount += 1;
  }

  public connected(key: string, at: Date): void {
    this.#machine.transition({
      to: "ACTIVE",
      reason: "webrtc_connected",
      initiator: "system",
      idempotencyKey: key,
      occurredAt: at,
    });
  }

  public failAllAttempts(key: string, at: Date): void {
    if (this.#attemptCount !== 5 || this.#machine.state !== "NEGOTIATING") {
      throw new Error("Full connection failure requires exactly five failed attempts");
    }
    this.#machine.transition({
      to: "FULLY_COMPENSATED",
      reason: "all_webrtc_attempts_failed",
      initiator: "system",
      idempotencyKey: key,
      occurredAt: at,
    });
    this.#usedSeconds = 0;
  }

  public end(key: string, at: Date): void {
    if (this.#machine.state !== "ACTIVE") {
      throw new Error("Only an active ride can end normally");
    }
    this.#machine.transition({
      to: "ENDING",
      reason: "user_ended",
      initiator: "user",
      idempotencyKey: `${key}:ending`,
      occurredAt: at,
    });
    const elapsed = this.#startedAt
      ? Math.max(0, Math.ceil((at.getTime() - this.#startedAt.getTime()) / 1000))
      : 0;
    this.#usedSeconds = Math.min(this.#input.purchasedSeconds, elapsed);
    this.#machine.transition({
      to: "COMPLETED",
      reason: "time_settled",
      initiator: "system",
      idempotencyKey: `${key}:completed`,
      occurredAt: at,
    });
  }

  public snapshot(): RideSnapshot {
    return {
      id: this.#input.id,
      userId: this.#input.userId,
      carId: this.#input.carId,
      state: this.#machine.state,
      version: this.#machine.version,
      purchasedSeconds: this.#input.purchasedSeconds,
      usedSeconds: this.#usedSeconds,
      remainingSeconds: Math.max(0, this.#input.purchasedSeconds - this.#usedSeconds),
      attemptCount: this.#attemptCount,
      startedAt: this.#startedAt?.toISOString() ?? null,
    };
  }
}
