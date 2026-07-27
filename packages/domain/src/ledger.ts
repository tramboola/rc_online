export type LedgerEntryKind =
  | "purchase"
  | "subscription_credit"
  | "promotion"
  | "ride_debit"
  | "compensation"
  | "admin_adjustment"
  | "expiry";

export interface LedgerEntry {
  readonly id: string;
  readonly walletId: string;
  readonly lotId: string | null;
  readonly kind: LedgerEntryKind;
  readonly seconds: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface WalletLot {
  readonly id: string;
  readonly walletId: string;
  readonly grantedSeconds: number;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface LedgerAppend {
  readonly id: string;
  readonly walletId: string;
  readonly lotId?: string | null;
  readonly kind: LedgerEntryKind;
  readonly seconds: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly occurredAt?: Date;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export class TimeLedger {
  readonly #entries: LedgerEntry[] = [];
  readonly #lots: WalletLot[] = [];
  readonly #byIdempotencyKey = new Map<string, LedgerEntry>();

  public get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  public get lots(): readonly WalletLot[] {
    return this.#lots;
  }

  public addLot(lot: WalletLot): WalletLot {
    if (lot.grantedSeconds <= 0) {
      throw new Error("Wallet lot must grant positive seconds");
    }
    if (this.#lots.some((existing) => existing.id === lot.id)) {
      throw new Error(`Wallet lot already exists: ${lot.id}`);
    }
    this.#lots.push(Object.freeze({ ...lot }));
    return lot;
  }

  public append(input: LedgerAppend): LedgerEntry {
    const duplicate = this.#byIdempotencyKey.get(input.idempotencyKey);
    if (duplicate) {
      return duplicate;
    }
    if (!Number.isSafeInteger(input.seconds) || input.seconds === 0) {
      throw new Error("Ledger seconds must be a non-zero safe integer");
    }
    if (input.kind === "admin_adjustment" && input.reason.trim().length < 8) {
      throw new Error("Admin adjustments require a meaningful reason");
    }

    const entry: LedgerEntry = Object.freeze({
      id: input.id,
      walletId: input.walletId,
      lotId: input.lotId ?? null,
      kind: input.kind,
      seconds: input.seconds,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    });
    this.#entries.push(entry);
    this.#byIdempotencyKey.set(entry.idempotencyKey, entry);
    return entry;
  }

  public balance(walletId: string, at: Date = new Date()): number {
    const expiredLots = new Set(
      this.#lots
        .filter(
          (lot) =>
            lot.walletId === walletId &&
            lot.expiresAt !== null &&
            new Date(lot.expiresAt).getTime() <= at.getTime(),
        )
        .map((lot) => lot.id),
    );

    return this.#entries
      .filter(
        (entry) =>
          entry.walletId === walletId &&
          (entry.lotId === null || !expiredLots.has(entry.lotId)),
      )
      .reduce((sum, entry) => sum + entry.seconds, 0);
  }

  public debitFifo(input: {
    idFactory: () => string;
    walletId: string;
    seconds: number;
    idempotencyKey: string;
    reason: string;
    at?: Date;
  }): readonly LedgerEntry[] {
    const existing = this.#entries.filter((entry) =>
      entry.idempotencyKey.startsWith(`${input.idempotencyKey}:`),
    );
    if (existing.length > 0) {
      return existing;
    }

    const at = input.at ?? new Date();
    if (input.seconds <= 0 || !Number.isSafeInteger(input.seconds)) {
      throw new Error("Debit seconds must be a positive safe integer");
    }
    if (this.balance(input.walletId, at) < input.seconds) {
      throw new Error("Insufficient time balance");
    }

    let remaining = input.seconds;
    const result: LedgerEntry[] = [];
    const lots = this.#lots
      .filter(
        (lot) =>
          lot.walletId === input.walletId &&
          (lot.expiresAt === null || new Date(lot.expiresAt).getTime() > at.getTime()),
      )
      .sort((a, b) => {
        const expiryA = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const expiryB = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        return expiryA - expiryB || a.createdAt.localeCompare(b.createdAt);
      });

    for (const lot of lots) {
      if (remaining === 0) {
        break;
      }
      const available = this.#entries
        .filter((entry) => entry.walletId === input.walletId && entry.lotId === lot.id)
        .reduce((sum, entry) => sum + entry.seconds, 0);
      if (available <= 0) {
        continue;
      }
      const taken = Math.min(available, remaining);
      const entry = this.append({
        id: input.idFactory(),
        walletId: input.walletId,
        lotId: lot.id,
        kind: "ride_debit",
        seconds: -taken,
        idempotencyKey: `${input.idempotencyKey}:${result.length}`,
        reason: input.reason,
        occurredAt: at,
      });
      result.push(entry);
      remaining -= taken;
    }

    if (remaining !== 0) {
      throw new Error("Ledger lot invariant violated");
    }
    return result;
  }
}
