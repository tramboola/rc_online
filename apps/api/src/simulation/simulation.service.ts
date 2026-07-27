import { Injectable } from "@nestjs/common";
import type { CatalogProduct, RideSnapshot } from "@rc/contracts";
import { FairRideQueue, RideOrchestrator } from "@rc/domain";

const ids = {
  user: "20000000-0000-4000-8000-000000000001",
  wallet: "20000000-0000-4000-8000-000000000002",
  queue: "30000000-0000-4000-8000-000000000001",
  offer: "30000000-0000-4000-8000-000000000002",
  ride: "30000000-0000-4000-8000-000000000003",
  carBlue: "40000000-0000-4000-8000-000000000001",
  carRed: "40000000-0000-4000-8000-000000000002",
  carReserve: "40000000-0000-4000-8000-000000000003",
};

const catalog: readonly CatalogProduct[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    slug: "starter-5",
    name: "Starter 5",
    kind: "one_time",
    seconds: 300,
    amountMinor: 400,
    currency: "USD",
    rolloverSeconds: 0,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    slug: "starter-10",
    name: "Starter 10",
    kind: "one_time",
    seconds: 600,
    amountMinor: 700,
    currency: "USD",
    rolloverSeconds: 0,
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    slug: "race-pack",
    name: "Race Pack",
    kind: "one_time",
    seconds: 3000,
    amountMinor: 4500,
    currency: "USD",
    rolloverSeconds: 0,
  },
  {
    id: "50000000-0000-4000-8000-000000000004",
    slug: "casual",
    name: "Casual",
    kind: "subscription",
    seconds: 7200,
    amountMinor: 900,
    currency: "USD",
    rolloverSeconds: 3600,
  },
  {
    id: "50000000-0000-4000-8000-000000000005",
    slug: "racer",
    name: "Racer",
    kind: "subscription",
    seconds: 18000,
    amountMinor: 1900,
    currency: "USD",
    rolloverSeconds: 9000,
  },
  {
    id: "50000000-0000-4000-8000-000000000006",
    slug: "pro",
    name: "Pro",
    kind: "subscription",
    seconds: 36000,
    amountMinor: 2900,
    currency: "USD",
    rolloverSeconds: 18000,
  },
];

type Scenario =
  | "normal"
  | "webrtc-five-failures"
  | "tab-reconnect"
  | "pi-offline"
  | "esp32-offline"
  | "uart-corrupt"
  | "battery-low"
  | "battery-critical"
  | "wan-failover"
  | "redis-reset"
  | "timing-offline"
  | "camera-offline"
  | "public-stream-offline"
  | "disk-full"
  | "power-loss";

@Injectable()
export class SimulationService {
  readonly #queue = new FairRideQueue();
  readonly #rides = new Map<string, RideOrchestrator>();
  readonly #rideStartedAt = new Map<string, Date>();
  #scenario: Scenario = "normal";
  #balanceSeconds = 750;

  public status() {
    return {
      status:
        process.env.SIMULATION_VERIFIED === "true"
          ? "SIMULATION_READY"
          : "SIMULATION_CANDIDATE",
      site: {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Prague Neon Circuit",
        online: !["power-loss", "wan-failover"].includes(this.#scenario),
      },
      cars: [
        {
          id: ids.carBlue,
          name: "Night Runner",
          state: this.#scenario === "pi-offline" ? "OFFLINE" : "AVAILABLE",
          batteryPercent: this.#scenario === "battery-critical" ? 8 : 86,
          connection: "excellent",
        },
        {
          id: ids.carRed,
          name: "Red Comet",
          state: this.#scenario === "esp32-offline" ? "SAFETY_BLOCKED" : "AVAILABLE",
          batteryPercent: this.#scenario === "battery-low" ? 22 : 74,
          connection: "good",
        },
        {
          id: ids.carReserve,
          name: "Reserve 03",
          state: "OPERATOR_RECOVERY",
          batteryPercent: 58,
          connection: "offline",
        },
      ],
      queue: {
        open: true,
        count: this.#queue.snapshot().length,
        estimatedWaitSeconds: Math.max(60, this.#queue.snapshot().length * 300),
      },
      scenario: this.#scenario,
      generatedAt: new Date().toISOString(),
    };
  }

  public publicStream() {
    return {
      online: this.#scenario !== "public-stream-offline",
      playbackUrl: "http://localhost:8888/public/index.m3u8",
      viewers: 287,
    };
  }

  public season() {
    return {
      id: "10000000-0000-4000-8000-000000000003",
      slug: "season-01",
      name: "Season 01 — Neon Circuit",
      status: "live",
      endsAt: "2026-08-18T23:59:59.000Z",
      prizePoolMinor: 100000,
      currency: "USD",
    };
  }

  public leaderboard() {
    return [
      ["NIGHTSHIFT", 42817, "confirmed"],
      ["APEXGHOST", 43162, "confirmed"],
      ["REDLINE", 43498, "confirmed"],
      ["VORTEX", 43901, "confirmed"],
      ["BLITZ", 44112, "confirmed"],
      ["TURBOJAY", 44388, "confirmed"],
      ["SLIPSTREAM", 44776, "pending_review"],
      ["PHANTOM", 44993, "confirmed"],
    ].map(([nickname, durationMs, status], index) => ({
      rank: index + 1,
      nickname,
      durationMs,
      status,
    }));
  }

  public me() {
    return {
      id: ids.user,
      nickname: "GRIDRUNNER",
      role: "user",
      personas: ["user", "operator", "technical_admin", "business_admin", "moderator"],
      consents: {
        terms: "2026-07-01",
        privacy: "2026-07-01",
        age: "16-plus-v1",
      },
    };
  }

  public catalog(): readonly CatalogProduct[] {
    return catalog;
  }

  public wallet() {
    return {
      id: ids.wallet,
      unit: "seconds",
      balanceSeconds: this.#balanceSeconds,
      derivedFromLedger: true,
    };
  }

  public submitPreflight(input: Record<string, unknown>) {
    const latencyMs = typeof input.latencyMs === "number" ? input.latencyMs : 68;
    const ready = latencyMs <= 300 && this.#scenario !== "wan-failover";
    return {
      id: crypto.randomUUID(),
      latencyMs,
      stability: latencyMs <= 100 ? "good" : "degraded",
      ready,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      checks: {
        https: true,
        websocket: true,
        webrtc: this.#scenario !== "webrtc-five-failures",
        turn: true,
        videoDecode: true,
        neutral: true,
      },
    };
  }

  public joinQueue() {
    const member = this.#queue.join({
      id: ids.queue,
      userId: ids.user,
      status: "waiting",
      joinedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    const snapshot = this.#queue.snapshot();
    return {
      ...member,
      position: snapshot.findIndex((item) => item.id === member.id) + 1,
    };
  }

  public leaveQueue() {
    this.#queue.leave(ids.user);
    return { status: "left" };
  }

  public createOffer() {
    return this.#queue.offer({
      id: ids.offer,
      carIds: [ids.carBlue, ids.carRed],
      offeredAt: new Date(),
      ttlSeconds: 30,
    });
  }

  public acceptOffer(carId: string): RideSnapshot {
    this.#queue.accept(ids.offer, carId, new Date());
    const ride = new RideOrchestrator({
      id: ids.ride,
      userId: ids.user,
      carId,
      purchasedSeconds: 300,
    });
    const now = new Date();
    ride.offer(`offer:${ids.offer}`, now);
    ride.accept(`accept:${ids.offer}`, now);
    this.#rides.set(ids.ride, ride);
    return ride.snapshot();
  }

  public startNegotiation(rideId: string): RideSnapshot {
    const ride = this.getRideOrThrow(rideId);
    const attempts = this.#scenario === "webrtc-five-failures" ? 5 : 1;
    const startedAt = new Date();
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      ride.negotiationStarted(`negotiation:${rideId}:${attempt + 1}`, startedAt);
    }
    if (attempts === 5) {
      ride.failAllAttempts(`full-refund:${rideId}`, startedAt);
    } else {
      ride.connected(`connected:${rideId}`, startedAt);
      this.#rideStartedAt.set(rideId, startedAt);
    }
    return ride.snapshot();
  }

  public ride(rideId: string): RideSnapshot {
    return this.getRideOrThrow(rideId).snapshot();
  }

  public extend(rideId: string): RideSnapshot {
    if (this.#queue.snapshot().length > 0 || this.#balanceSeconds < 300) {
      throw new Error("Ride extension is not currently allowed");
    }
    return this.ride(rideId);
  }

  public end(rideId: string): RideSnapshot {
    const ride = this.getRideOrThrow(rideId);
    const startedAt = this.#rideStartedAt.get(rideId) ?? new Date();
    ride.end(`end:${rideId}`, new Date(startedAt.getTime() + 120_000));
    const snapshot = ride.snapshot();
    this.#balanceSeconds -= snapshot.usedSeconds;
    return snapshot;
  }

  public setScenario(scenario: Scenario) {
    this.#scenario = scenario;
    return {
      scenario,
      status: "applied",
      appliedAt: new Date().toISOString(),
      safetyAction:
        scenario === "normal"
          ? "none"
          : ["camera-offline", "public-stream-offline", "timing-offline"].includes(
                scenario,
              )
            ? "degraded_non_control_path"
            : "neutral_and_block_new_rides",
    };
  }

  private getRideOrThrow(rideId: string): RideOrchestrator {
    const ride = this.#rides.get(rideId);
    if (!ride) {
      throw new Error(`Ride not found: ${rideId}`);
    }
    return ride;
  }
}
