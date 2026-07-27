import { describe, expect, it } from "vitest";

import {
  FairRideQueue,
  RideOrchestrator,
  TimeLedger,
  createRideStateMachine,
} from "./index.js";

const ids = {
  ride: "2c71c985-30e1-48c4-b5dc-b7a4f2a2da36",
  user: "cc977898-a9d1-418f-a487-b609a86c9b30",
  car: "0f3ac4fb-640a-42f0-9793-92a14a13a420",
  wallet: "21f4e6bb-4b39-4d28-a27e-efdeac906dbc",
};

describe("state machines", () => {
  it("rejects skipped ride transitions and deduplicates accepted transitions", () => {
    const ride = createRideStateMachine(ids.ride);
    expect(() =>
      ride.transition({
        to: "ACTIVE",
        reason: "invalid skip",
        initiator: "system",
        idempotencyKey: "invalid-skip",
      }),
    ).toThrow(/Invalid ride transition/);

    const first = ride.transition({
      to: "OFFERED",
      reason: "fifo",
      initiator: "system",
      idempotencyKey: "offer-once",
    });
    const duplicate = ride.transition({
      to: "OFFERED",
      reason: "fifo",
      initiator: "system",
      idempotencyKey: "offer-once",
    });
    expect(duplicate).toEqual(first);
    expect(ride.version).toBe(2);
  });
});

describe("time ledger", () => {
  it("derives balance from immutable entries and debits expiring lots first", () => {
    const ledger = new TimeLedger();
    ledger.addLot({
      id: "lot-a",
      walletId: ids.wallet,
      grantedSeconds: 300,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    ledger.addLot({
      id: "lot-b",
      walletId: ids.wallet,
      grantedSeconds: 600,
      createdAt: "2026-01-02T00:00:00.000Z",
      expiresAt: null,
    });
    ledger.append({
      id: "credit-a",
      walletId: ids.wallet,
      lotId: "lot-a",
      kind: "purchase",
      seconds: 300,
      idempotencyKey: "purchase-a",
      reason: "starter pack",
    });
    ledger.append({
      id: "credit-b",
      walletId: ids.wallet,
      lotId: "lot-b",
      kind: "subscription_credit",
      seconds: 600,
      idempotencyKey: "purchase-b",
      reason: "monthly credit",
    });

    let id = 0;
    ledger.debitFifo({
      idFactory: () => `debit-${++id}`,
      walletId: ids.wallet,
      seconds: 420,
      idempotencyKey: "ride-1",
      reason: "ride settlement",
      at: new Date("2026-07-25T00:00:00.000Z"),
    });
    expect(ledger.balance(ids.wallet, new Date("2026-07-25T00:00:00.000Z"))).toBe(
      480,
    );
    expect(ledger.entries.at(-2)?.lotId).toBe("lot-a");
    expect(ledger.entries.at(-1)?.lotId).toBe("lot-b");
  });
});

describe("queue and ride orchestration", () => {
  it("keeps one active queue position per user", () => {
    const queue = new FairRideQueue();
    const member = {
      id: "queue-1",
      userId: ids.user,
      joinedAt: "2026-07-25T10:00:00.000Z",
      expiresAt: "2026-07-25T10:30:00.000Z",
      status: "waiting" as const,
    };
    expect(queue.join(member)).toBe(member);
    expect(queue.join({ ...member, id: "queue-2" }).id).toBe("queue-1");
    expect(queue.snapshot(new Date("2026-07-25T10:01:00.000Z"))).toHaveLength(1);
  });

  it("fully compensates only after five failed WebRTC attempts", () => {
    const ride = new RideOrchestrator({
      id: ids.ride,
      userId: ids.user,
      carId: ids.car,
      purchasedSeconds: 300,
    });
    const start = new Date("2026-07-25T10:00:00.000Z");
    ride.offer("offer-ride", start);
    ride.accept("accept-ride", start);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      ride.negotiationStarted(`attempt-${attempt}`, start);
    }
    ride.failAllAttempts("refund-all", start);
    expect(ride.snapshot()).toMatchObject({
      state: "FULLY_COMPENSATED",
      attemptCount: 5,
      usedSeconds: 0,
      remainingSeconds: 300,
    });
  });
});
