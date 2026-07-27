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
});
