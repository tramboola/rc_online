import type {
  ActorType,
  CarState,
  RideState,
  StateTransition,
} from "@rc/contracts";

export class InvalidTransitionError extends Error {
  public constructor(
    public readonly entity: "car" | "ride",
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

const carTransitions: Readonly<Record<CarState, readonly CarState[]>> = {
  OFFLINE: ["INITIALIZING", "ADMIN_BLOCKED"],
  INITIALIZING: ["AVAILABLE", "OFFLINE", "SAFETY_BLOCKED", "ADMIN_BLOCKED"],
  AVAILABLE: ["RESERVED", "OFFLINE", "SAFETY_BLOCKED", "ADMIN_BLOCKED"],
  RESERVED: ["CONNECTING", "AVAILABLE", "OFFLINE", "SAFETY_BLOCKED"],
  CONNECTING: ["ACTIVE", "AVAILABLE", "OFFLINE", "SAFETY_BLOCKED"],
  ACTIVE: [
    "RECONNECT_GRACE",
    "RETURN_REQUIRED",
    "OPERATOR_RECOVERY",
    "SAFETY_BLOCKED",
  ],
  RECONNECT_GRACE: ["ACTIVE", "RETURN_REQUIRED", "SAFETY_BLOCKED"],
  RETURN_REQUIRED: ["OPERATOR_RECOVERY", "AVAILABLE", "SAFETY_BLOCKED"],
  OPERATOR_RECOVERY: ["AVAILABLE", "SAFETY_BLOCKED", "ADMIN_BLOCKED"],
  SAFETY_BLOCKED: ["INITIALIZING", "ADMIN_BLOCKED"],
  ADMIN_BLOCKED: ["INITIALIZING"],
};

const rideTransitions: Readonly<Record<RideState, readonly RideState[]>> = {
  CREATED: ["OFFERED", "FAILED"],
  OFFERED: ["ACCEPTED", "FAILED"],
  ACCEPTED: ["NEGOTIATING", "FAILED"],
  NEGOTIATING: ["ACTIVE", "FAILED", "FULLY_COMPENSATED"],
  ACTIVE: ["RECONNECT_GRACE", "PAUSED_SITE_FAILOVER", "ENDING"],
  RECONNECT_GRACE: ["ACTIVE", "ENDING", "PARTIALLY_COMPENSATED"],
  PAUSED_SITE_FAILOVER: ["ACTIVE", "ENDING", "PARTIALLY_COMPENSATED"],
  ENDING: ["COMPLETED", "PARTIALLY_COMPENSATED", "FULLY_COMPENSATED"],
  COMPLETED: [],
  FAILED: ["FULLY_COMPENSATED"],
  PARTIALLY_COMPENSATED: [],
  FULLY_COMPENSATED: [],
};

export class VersionedStateMachine<TState extends string> {
  readonly #transitions: Readonly<Record<TState, readonly TState[]>>;
  readonly #entity: "car" | "ride";
  readonly #entityId: string;
  readonly #history: StateTransition[] = [];
  #state: TState;
  #version = 1;

  public constructor(input: {
    entity: "car" | "ride";
    entityId: string;
    initialState: TState;
    transitions: Readonly<Record<TState, readonly TState[]>>;
  }) {
    this.#entity = input.entity;
    this.#entityId = input.entityId;
    this.#state = input.initialState;
    this.#transitions = input.transitions;
  }

  public get state(): TState {
    return this.#state;
  }

  public get version(): number {
    return this.#version;
  }

  public get history(): readonly StateTransition[] {
    return this.#history;
  }

  public transition(input: {
    to: TState;
    reason: string;
    initiator: ActorType;
    idempotencyKey: string;
    occurredAt?: Date;
  }): StateTransition {
    const existing = this.#history.find(
      (event) => event.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }
    if (!this.#transitions[this.#state].includes(input.to)) {
      throw new InvalidTransitionError(this.#entity, this.#state, input.to);
    }
    const event: StateTransition = {
      entityId: this.#entityId,
      from: this.#state,
      to: input.to,
      reason: input.reason,
      initiator: input.initiator,
      version: this.#version + 1,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      idempotencyKey: input.idempotencyKey,
    };
    this.#state = input.to;
    this.#version = event.version;
    this.#history.push(event);
    return event;
  }
}

export function createCarStateMachine(
  carId: string,
  state: CarState = "OFFLINE",
): VersionedStateMachine<CarState> {
  return new VersionedStateMachine({
    entity: "car",
    entityId: carId,
    initialState: state,
    transitions: carTransitions,
  });
}

export function createRideStateMachine(
  rideId: string,
  state: RideState = "CREATED",
): VersionedStateMachine<RideState> {
  return new VersionedStateMachine({
    entity: "ride",
    entityId: rideId,
    initialState: state,
    transitions: rideTransitions,
  });
}
