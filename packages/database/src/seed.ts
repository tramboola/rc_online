import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

const seed = {
  siteId: "10000000-0000-4000-8000-000000000001",
  trackId: "10000000-0000-4000-8000-000000000002",
  seasonId: "10000000-0000-4000-8000-000000000003",
  userId: "20000000-0000-4000-8000-000000000001",
  walletId: "20000000-0000-4000-8000-000000000002",
  lotId: "20000000-0000-4000-8000-000000000003",
};

await sql.begin(async (tx) => {
  await tx`
    insert into sites (id, slug, name, timezone, status)
    values (${seed.siteId}, 'prague-neon', 'Prague Neon Circuit', 'Europe/Prague', 'online')
    on conflict (id) do nothing
  `;
  await tx`
    insert into tracks (id, site_id, slug, name, status)
    values (${seed.trackId}, ${seed.siteId}, 'neon-circuit', 'Neon Circuit', 'active')
    on conflict (id) do nothing
  `;
  await tx`
    insert into seasons (id, site_id, slug, name, starts_at, ends_at, status)
    values (
      ${seed.seasonId},
      ${seed.siteId},
      'season-01',
      'Season 01 — Neon Circuit',
      '2026-07-01T00:00:00Z',
      '2026-08-18T23:59:59Z',
      'active'
    )
    on conflict (id) do nothing
  `;
  await tx`
    insert into users (id, email, display_name, role)
    values (${seed.userId}, 'driver@mock.rc', 'Gridrunner', 'user')
    on conflict (id) do nothing
  `;
  await tx`
    insert into nicknames (user_id, nickname)
    values (${seed.userId}, 'GRIDRUNNER')
    on conflict do nothing
  `;
  await tx`
    insert into wallets (id, user_id)
    values (${seed.walletId}, ${seed.userId})
    on conflict (id) do nothing
  `;
  await tx`
    insert into wallet_lots (
      id, wallet_id, source_type, source_id, granted_seconds, expires_at
    )
    values (
      ${seed.lotId},
      ${seed.walletId},
      'seed',
      'simulation-starter',
      1050,
      '2027-01-01T00:00:00Z'
    )
    on conflict (id) do nothing
  `;
  await tx`
    insert into ledger_entries (
      wallet_id, lot_id, kind, seconds, idempotency_key, reason
    )
    values (
      ${seed.walletId},
      ${seed.lotId},
      'promotion',
      1050,
      'seed:wallet:gridrunner',
      'Deterministic simulation credit'
    )
    on conflict (idempotency_key) do nothing
  `;
});

await sql.end();
process.stdout.write("Deterministic simulation seed applied\n");
