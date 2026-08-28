import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { accountActionTokens, passwordCredentials, users } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("versioned SQL migrations", () => {
  it("contains every entity required by specification section 37", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0001_simulation_core.sql"),
      "utf8",
    );
    const required = [
      "users", "oauth_identities", "nicknames", "consents", "products", "prices",
      "purchases", "stripe_events", "subscriptions", "wallets", "wallet_lots",
      "ledger_entries", "promo_campaigns", "promo_codes", "promo_redemptions",
      "sites", "tracks", "track_layouts", "seasons", "cars", "devices",
      "components", "batteries", "transponders", "car_component_assignments",
      "calibration_profiles", "firmware_versions", "device_enrollments",
      "queue_entries", "ride_offers", "rides", "ride_state_events",
      "ride_time_segments", "connection_attempts", "connection_summaries",
      "operator_actions", "compensation_entries", "timing_passes", "laps",
      "lap_validation_events", "leaderboard_entries", "moderation_decisions",
      "season_snapshots", "prizes", "incidents", "incident_comments",
      "camera_exports", "alerts", "telemetry_summaries", "audit_events",
      "outbox_events", "inbox_events"
    ];
    for (const table of required) {
      expect(sql, `migration should define ${table}`).toMatch(
        new RegExp(`create table(?: if not exists)? ${table}\\b`, "i"),
      );
    }
  });

  it("makes ledger rows append-only", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0002_ledger_immutability.sql"),
      "utf8",
    );
    expect(sql).toContain("before update or delete on ledger_entries");
    expect(sql).toContain("raise exception");
  });

  it("adds persistent Google authentication state", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0003_google_auth.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter table users\s+add column email_verified_at timestamptz/i);
    expect(sql).toMatch(/create table auth_sessions\b/i);
    expect(sql).toMatch(/token_hash text not null unique/i);
    expect(sql).toMatch(/create index auth_sessions_expiry_idx/i);
    expect(sql).toMatch(/create table account_balances\b/i);
    expect(sql).toMatch(/check \(amount_minor >= 0\)/i);
  });

  it("adds physical car enrollment, credentials, health, and drive sessions", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0004_device_gateway.sql"),
      "utf8",
    );

    expect(sql).toMatch(/create table device_enrollment_tokens\b/i);
    expect(sql).toMatch(/token_hash text not null unique/i);
    expect(sql).toMatch(/create table device_credentials\b/i);
    expect(sql).toMatch(/secret_hash text not null unique/i);
    expect(sql).toMatch(/create table drive_sessions\b/i);
    expect(sql).toMatch(/alter table devices[\s\S]+agent_version text/i);
    expect(sql).toMatch(/health jsonb not null default '\{\}'::jsonb/i);
    expect(sql).toMatch(/drive_sessions_one_active_car_uidx/i);
  });

  it("adds bounded per-car steering trim", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0005_car_steering_trim.sql"),
      "utf8",
    );

    expect(sql).toMatch(
      /alter table cars\s+add column steering_trim_percent integer not null default 0/i,
    );
    expect(sql).toMatch(
      /check \(steering_trim_percent between -20 and 20\)/i,
    );
  });

  it("adds immutable Pi agent releases and bounded update jobs", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0006_agent_ota.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter table firmware_versions[\s\S]+artifact_url text/i);
    expect(sql).toMatch(/create table device_update_jobs\b/i);
    expect(sql).toMatch(/where status in \('pending', 'downloading', 'applying'\)/i);
    expect(sql).toMatch(/attempt_count between 0 and 1/i);
  });

  it("adds durable account profile, password, token, and rate-limit state", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0007_account_profiles.sql"),
      "utf8",
    );

    expect(sql).toContain('ADD COLUMN "avatar_key" text');
    expect(sql).toContain('CREATE TABLE "password_credentials"');
    expect(sql).toContain('CREATE TABLE "account_action_tokens"');
    expect(sql).toContain('CREATE TABLE "auth_rate_limits"');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('CREATE UNIQUE INDEX "account_action_tokens_token_hash_unique"');
    expect(sql).toContain('CHECK ("kind" IN (\'verify_email\', \'reset_password\'))');
    expect(sql).toContain('CHECK ("attempt_count" > 0)');
    expect(sql).toContain('CREATE INDEX "account_action_tokens_user_kind_idx"');
    expect(sql).toContain('CREATE INDEX "auth_rate_limits_expiry_idx"');
    expect(sql).toContain('INSERT INTO "nicknames" ("user_id", "nickname", "avatar_key")');
    expect(sql).toContain('INSERT INTO "account_balances" ("user_id", "currency", "amount_minor")');
  });

  it("keeps password credential verification separate from user email verification", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0007_account_profiles.sql"),
      "utf8",
    );

    expect(sql).toMatch(
      /create table "password_credentials" \([^;]*"verified_at" timestamptz[^;]*\);/i,
    );
    expect(passwordCredentials.verifiedAt.name).toBe("verified_at");
    expect(passwordCredentials.verifiedAt.notNull).toBe(false);
    expect(users.emailVerifiedAt.name).toBe("email_verified_at");
  });

  it("links a drive session to exactly one live queue entry", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0008_live_queue.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter table drive_sessions[\s\S]+queue_entry_id uuid/i);
    expect(sql).toMatch(/references queue_entries\(id\)/i);
    expect(sql).toMatch(/drive_sessions_queue_entry_uidx/i);
    expect(sql).toMatch(/queue_entries_one_live_user_uidx/i);
    expect(sql).toMatch(/row_number\(\) over \(partition by user_id/i);
    expect(sql).toMatch(/drop index if exists queue_entries_one_active_per_user_uidx/i);
    expect(sql).toMatch(/update queue_entries[\s\S]+status = 'expired'[\s\S]+status = 'accepted'/i);
  });

  it("backfills a nickname for every active user without case-insensitive collisions", async () => {
    const sql = await readFile(
      path.resolve(here, "../migrations/0007_account_profiles.sql"),
      "utf8",
    );

    expect(sql).toMatch(/FOR user_record IN[\s\S]+u\."disabled_at" IS NULL[\s\S]+ORDER BY u\."id"/i);
    expect(sql).toMatch(
      /uuid_suffix := upper\(substr\(replace\(user_record\."id"::text, '-', ''\), 9, 24\)\)/i,
    );
    expect(sql).toMatch(
      /WHILE EXISTS[\s\S]+lower\(n\."nickname"\) = lower\(candidate_nickname\)[\s\S]+LOOP/i,
    );
    expect(sql).toMatch(/candidate_nickname := base_nickname \|\| '-' \|\| uuid_suffix/i);
    expect(sql).toMatch(
      /candidate_nickname := base_nickname \|\| '-' \|\| uuid_suffix \|\| '-' \|\| collision_attempt::text/i,
    );
    expect(sql).toMatch(
      /INSERT INTO "nicknames" \("user_id", "nickname", "avatar_key"\)[\s\S]+VALUES \(user_record\."id", candidate_nickname, 'racer-red'\)/i,
    );
  });

  it("declares the account token kind constraint in the Drizzle schema", () => {
    const kindCheck = getTableConfig(accountActionTokens).checks.find(
      (constraint) => constraint.name === "account_action_tokens_kind_check",
    );

    expect(kindCheck).toBeDefined();
    if (!kindCheck) return;

    const checkSql = new PgDialect().sqlToQuery(kindCheck.value).sql;
    expect(checkSql).toContain("'verify_email'");
    expect(checkSql).toContain("'reset_password'");
  });
});
