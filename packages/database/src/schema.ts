import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("user"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("users_email_lower_uidx").on(sql`lower(${table.email})`),
]);

export const oauthIdentities = pgTable("oauth_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("oauth_identity_provider_subject_uidx").on(
    table.provider,
    table.providerSubject,
  ),
]);

export const nicknames = pgTable("nicknames", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  nickname: text("nickname").notNull(),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("nicknames_lower_uidx").on(sql`lower(${table.nickname})`),
]);

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  documentVersion: text("document_version").notNull(),
  accepted: boolean("accepted").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("consents_user_kind_version_uidx").on(
    table.userId,
    table.kind,
    table.documentVersion,
  ),
]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  active: boolean("active").notNull().default(true),
  stripeProductId: text("stripe_product_id").unique(),
  ...auditColumns,
});

export const prices = pgTable("prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  seconds: integer("seconds").notNull(),
  rolloverSeconds: integer("rollover_seconds").notNull().default(0),
  stripePriceId: text("stripe_price_id").unique(),
  active: boolean("active").notNull().default(true),
  ...auditColumns,
}, (table) => [
  check("prices_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  check("prices_seconds_positive", sql`${table.seconds} > 0`),
]);

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  unit: text("unit").notNull().default("seconds"),
  ...auditColumns,
});

export const walletLots = pgTable("wallet_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id").notNull().references(() => wallets.id),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  grantedSeconds: integer("granted_seconds").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("wallet_lots_source_uidx").on(table.sourceType, table.sourceId),
  check("wallet_lots_grant_positive", sql`${table.grantedSeconds} > 0`),
  index("wallet_lots_wallet_expiry_idx").on(table.walletId, table.expiresAt),
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id").notNull().references(() => wallets.id),
  lotId: uuid("lot_id").references(() => walletLots.id),
  kind: text("kind").notNull(),
  seconds: integer("seconds").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("ledger_seconds_nonzero", sql`${table.seconds} <> 0`),
  index("ledger_wallet_time_idx").on(table.walletId, table.occurredAt),
]);

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("offline"),
  ...auditColumns,
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  ...auditColumns,
});

export const cars = pgTable("cars", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  stateVersion: integer("state_version").notNull().default(1),
  batteryPercent: integer("battery_percent"),
  adminBlocked: boolean("admin_blocked").notNull().default(false),
  ...auditColumns,
}, (table) => [
  check(
    "cars_battery_range",
    sql`${table.batteryPercent} is null or (${table.batteryPercent} >= 0 and ${table.batteryPercent} <= 100)`,
  ),
  index("cars_site_state_idx").on(table.siteId, table.state),
]);

export const queueEntries = pgTable("queue_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: text("status").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  preflightResultId: uuid("preflight_result_id"),
  ...auditColumns,
}, (table) => [
  index("queue_fifo_idx").on(table.status, table.joinedAt),
]);

export const rides = pgTable("rides", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  carId: uuid("car_id").notNull().references(() => cars.id),
  state: text("state").notNull(),
  stateVersion: integer("state_version").notNull().default(1),
  purchasedSeconds: integer("purchased_seconds").notNull(),
  usedSeconds: integer("used_seconds").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  correlationId: uuid("correlation_id").notNull(),
  ...auditColumns,
}, (table) => [
  check("rides_time_nonnegative", sql`${table.purchasedSeconds} >= 0 and ${table.usedSeconds} >= 0`),
  index("rides_user_created_idx").on(table.userId, table.createdAt),
]);

export const rideStateEvents = pgTable("ride_state_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  rideId: uuid("ride_id").notNull().references(() => rides.id),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  reason: text("reason").notNull(),
  initiator: text("initiator").notNull(),
  version: integer("version").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ride_state_ride_version_uidx").on(table.rideId, table.version),
]);

export const connectionAttempts = pgTable("connection_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  rideId: uuid("ride_id").notNull().references(() => rides.id),
  attempt: integer("attempt").notNull(),
  route: text("route").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
}, (table) => [
  uniqueIndex("connection_attempt_ride_number_uidx").on(table.rideId, table.attempt),
  check("connection_attempt_range", sql`${table.attempt} between 1 and 5`),
]);

export const timingPasses = pgTable("timing_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  checkpoint: text("checkpoint").notNull(),
  transponder: text("transponder").notNull(),
  monotonicUs: bigint("monotonic_us", { mode: "number" }).notNull(),
  utcTime: timestamp("utc_time", { withTimezone: true }).notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  signalMetadata: jsonb("signal_metadata").notNull().default({}),
}, (table) => [
  uniqueIndex("timing_provider_site_sequence_uidx").on(
    table.provider,
    table.siteId,
    table.sequence,
  ),
]);

export const laps = pgTable("laps", {
  id: uuid("id").primaryKey().defaultRandom(),
  rideId: uuid("ride_id").notNull().references(() => rides.id),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  lapNumber: integer("lap_number").notNull(),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(),
  invalidReason: text("invalid_reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("laps_ride_number_uidx").on(table.rideId, table.lapNumber),
]);

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  producer: text("producer").notNull(),
  producerSequence: bigint("producer_sequence", { mode: "number" }).notNull(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("outbox_producer_sequence_uidx").on(
    table.producer,
    table.producerSequence,
  ),
  index("outbox_delivery_idx").on(table.status, table.nextAttemptAt),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  correlationId: uuid("correlation_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_target_time_idx").on(table.targetType, table.targetId, table.occurredAt),
]);
