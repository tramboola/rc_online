import { z } from "zod";

export const CarStateSchema = z.enum([
  "OFFLINE",
  "INITIALIZING",
  "AVAILABLE",
  "RESERVED",
  "CONNECTING",
  "ACTIVE",
  "RECONNECT_GRACE",
  "RETURN_REQUIRED",
  "OPERATOR_RECOVERY",
  "SAFETY_BLOCKED",
  "ADMIN_BLOCKED",
]);
export type CarState = z.infer<typeof CarStateSchema>;

export const RideStateSchema = z.enum([
  "CREATED",
  "OFFERED",
  "ACCEPTED",
  "NEGOTIATING",
  "ACTIVE",
  "RECONNECT_GRACE",
  "PAUSED_SITE_FAILOVER",
  "ENDING",
  "COMPLETED",
  "FAILED",
  "PARTIALLY_COMPENSATED",
  "FULLY_COMPENSATED",
]);
export type RideState = z.infer<typeof RideStateSchema>;

export const ActorTypeSchema = z.enum([
  "user",
  "system",
  "operator",
  "technical_admin",
  "business_admin",
  "device",
]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const StateTransitionSchema = z.object({
  entityId: z.string().uuid(),
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string().min(1).max(256),
  initiator: ActorTypeSchema,
  version: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(8).max(128),
});
export type StateTransition = z.infer<typeof StateTransitionSchema>;

export const WebSocketEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1).max(128),
  event_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  occurred_at: z.string().datetime(),
  payload: z.unknown(),
});
export type WebSocketEnvelope = z.infer<typeof WebSocketEnvelopeSchema>;

export const RideGrantClaimsSchema = z.object({
  aud: z.literal("ride-control"),
  jti: z.string().uuid(),
  ride_id: z.string().uuid(),
  user_id: z.string().uuid(),
  car_id: z.string().uuid(),
  site_id: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
export type RideGrantClaims = z.infer<typeof RideGrantClaimsSchema>;

export const TimingPassSchema = z.object({
  provider: z.enum(["simulator", "openstint", "trackmate"]),
  siteId: z.string().uuid(),
  checkpoint: z.string().min(1).max(64),
  transponder: z.string().min(1).max(128),
  monotonicUs: z.number().int().nonnegative(),
  utcTime: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
  signal: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type TimingPass = z.infer<typeof TimingPassSchema>;

export const ControlCommandSchema = z.object({
  version: z.literal(1),
  type: z.literal("control"),
  rideIdTruncated: z.string().regex(/^[a-f0-9]{16}$/),
  sequence: z.number().int().nonnegative().max(0xffffffff),
  monotonicMs: z.number().int().nonnegative(),
  steering: z.number().int().min(-1000).max(1000),
  throttle: z.number().int().min(0).max(1000),
  brake: z.number().int().min(0).max(1000),
  flags: z.number().int().nonnegative().max(0xffff),
});
export type ControlCommand = z.infer<typeof ControlCommandSchema>;

export const CatalogProductSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["one_time", "subscription"]),
  seconds: z.number().int().positive(),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  rolloverSeconds: z.number().int().nonnegative().default(0),
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export const QueueEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  position: z.number().int().positive(),
  joinedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: z.enum(["waiting", "offered", "accepted", "left", "expired"]),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

export const RideSnapshotSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  carId: z.string().uuid(),
  state: RideStateSchema,
  version: z.number().int().positive(),
  purchasedSeconds: z.number().int().nonnegative(),
  usedSeconds: z.number().int().nonnegative(),
  remainingSeconds: z.number().int().nonnegative(),
  attemptCount: z.number().int().min(0).max(5),
  startedAt: z.string().datetime().nullable(),
});
export type RideSnapshot = z.infer<typeof RideSnapshotSchema>;

export interface IdentityProvider {
  authenticate(input: unknown): Promise<{
    externalSubject: string;
    email: string;
    displayName: string;
  }>;
}

export interface PaymentProvider {
  createCheckout(input: {
    userId: string;
    priceId: string;
    idempotencyKey: string;
  }): Promise<{ providerSessionId: string; url: string }>;
  verifyWebhook(rawBody: Buffer, signature: string): Promise<unknown>;
}

export interface IceServerProvider {
  getIceServers(rideId: string): Promise<
    ReadonlyArray<{ urls: string | string[]; username?: string; credential?: string }>
  >;
}

export interface TimingProvider {
  start(onPass: (pass: TimingPass) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export interface Esp32Transport {
  send(command: Uint8Array): Promise<void>;
  neutral(reason: string): Promise<void>;
  health(): Promise<{ online: boolean; lastSequence: number }>;
}
