export interface QueueMember {
  readonly id: string;
  readonly userId: string;
  readonly joinedAt: string;
  readonly expiresAt: string;
  status: "waiting" | "offered" | "accepted" | "left" | "expired";
}

export interface RideOffer {
  readonly id: string;
  readonly queueEntryId: string;
  readonly userId: string;
  readonly carIds: readonly string[];
  readonly offeredAt: string;
  readonly expiresAt: string;
  acceptedCarId: string | null;
}

export class FairRideQueue {
  readonly #members: QueueMember[] = [];
  readonly #offers = new Map<string, RideOffer>();

  public join(member: QueueMember): QueueMember {
    const active = this.#members.find(
      (item) =>
        item.userId === member.userId &&
        (item.status === "waiting" ||
          item.status === "offered" ||
          item.status === "accepted"),
    );
    if (active) {
      return active;
    }
    this.#members.push(member);
    return member;
  }

  public snapshot(at: Date = new Date()): readonly QueueMember[] {
    this.expire(at);
    return this.#members
      .filter((member) => member.status === "waiting" || member.status === "offered")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  public leave(userId: string): void {
    const member = this.#members.find(
      (item) => item.userId === userId && item.status === "waiting",
    );
    if (member) {
      member.status = "left";
    }
  }

  public offer(input: {
    id: string;
    carIds: readonly string[];
    offeredAt: Date;
    ttlSeconds?: number;
  }): RideOffer {
    const member = this.snapshot(input.offeredAt).find(
      (item) => item.status === "waiting",
    );
    if (!member) {
      throw new Error("Queue is empty");
    }
    const ttlSeconds = input.ttlSeconds ?? 30;
    member.status = "offered";
    const offer: RideOffer = {
      id: input.id,
      queueEntryId: member.id,
      userId: member.userId,
      carIds: input.carIds,
      offeredAt: input.offeredAt.toISOString(),
      expiresAt: new Date(input.offeredAt.getTime() + ttlSeconds * 1000).toISOString(),
      acceptedCarId: null,
    };
    this.#offers.set(offer.id, offer);
    return offer;
  }

  public accept(offerId: string, carId: string, at: Date): RideOffer {
    const offer = this.#offers.get(offerId);
    if (!offer) {
      throw new Error("Ride offer not found");
    }
    if (new Date(offer.expiresAt).getTime() <= at.getTime()) {
      throw new Error("Ride offer expired");
    }
    if (!offer.carIds.includes(carId)) {
      throw new Error("Car is not part of this offer");
    }
    const member = this.#members.find((item) => item.id === offer.queueEntryId);
    if (!member || member.status !== "offered") {
      throw new Error("Queue entry cannot accept this offer");
    }
    offer.acceptedCarId = carId;
    member.status = "accepted";
    return offer;
  }

  private expire(at: Date): void {
    for (const member of this.#members) {
      if (
        (member.status === "waiting" || member.status === "offered") &&
        new Date(member.expiresAt).getTime() <= at.getTime()
      ) {
        member.status = "expired";
      }
    }
  }
}
