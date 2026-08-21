import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
});
