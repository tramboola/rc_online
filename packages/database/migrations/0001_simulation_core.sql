create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role text not null default 'user',
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_lower_uidx on users (lower(email));

create table oauth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create table nicknames (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  nickname text not null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index nicknames_lower_uidx on nicknames (lower(nickname));

create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null,
  document_version text not null,
  accepted boolean not null,
  occurred_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (user_id, kind, document_version)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('one_time', 'subscription')),
  active boolean not null default true,
  stripe_product_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  amount_minor integer not null check (amount_minor >= 0),
  currency char(3) not null,
  seconds integer not null check (seconds > 0),
  rollover_seconds integer not null default 0 check (rollover_seconds >= 0),
  stripe_price_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  price_id uuid not null references prices(id),
  provider text not null,
  provider_session_id text not null unique,
  amount_minor integer not null,
  currency char(3) not null,
  status text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  livemode boolean not null,
  api_version text,
  payload jsonb not null,
  status text not null default 'received',
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  product_id uuid not null references products(id),
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  unit text not null default 'seconds' check (unit = 'seconds'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallet_lots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id),
  source_type text not null,
  source_id text not null,
  granted_seconds integer not null check (granted_seconds > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index wallet_lots_wallet_expiry_idx on wallet_lots (wallet_id, expires_at);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id),
  lot_id uuid references wallet_lots(id),
  kind text not null,
  seconds integer not null check (seconds <> 0),
  idempotency_key text not null unique,
  reason text not null,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index ledger_wallet_time_idx on ledger_entries (wallet_id, occurred_at);

create table promo_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references promo_campaigns(id),
  code text not null,
  seconds integer not null check (seconds > 0),
  max_redemptions integer,
  redemptions integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index promo_codes_lower_uidx on promo_codes (lower(code));

create table promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id),
  user_id uuid not null references users(id),
  wallet_lot_id uuid not null references wallet_lots(id),
  redeemed_at timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null,
  status text not null default 'offline',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tracks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  slug text not null unique,
  name text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table track_layouts (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id),
  version integer not null,
  layout jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (track_id, version)
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  slug text not null unique,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table cars (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  slug text not null unique,
  name text not null,
  state text not null,
  state_version integer not null default 1,
  battery_percent integer check (battery_percent between 0 and 100),
  admin_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cars_site_state_idx on cars (site_id, state);

create table devices (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references cars(id),
  site_id uuid not null references sites(id),
  kind text not null,
  serial_number text not null unique,
  state text not null,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table components (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  kind text not null,
  model text not null,
  state text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table batteries (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null unique references components(id),
  capacity_mah integer,
  cycle_count integer not null default 0,
  health_percent integer check (health_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create table transponders (
  id uuid primary key default gen_random_uuid(),
  component_id uuid references components(id),
  external_id text not null unique,
  provider text not null,
  created_at timestamptz not null default now()
);

create table car_component_assignments (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id),
  component_id uuid not null references components(id),
  assigned_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index car_component_active_uidx
  on car_component_assignments (component_id)
  where removed_at is null;

create table calibration_profiles (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id),
  version integer not null,
  profile jsonb not null,
  valid boolean not null default false,
  signed_by uuid references users(id),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (car_id, version)
);

create table firmware_versions (
  id uuid primary key default gen_random_uuid(),
  component_kind text not null,
  version text not null,
  digest_sha256 text not null,
  signature text not null,
  channel text not null,
  created_at timestamptz not null default now(),
  unique (component_kind, version)
);

create table device_enrollments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  certificate_fingerprint text not null unique,
  status text not null,
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table preflight_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  latency_ms integer not null,
  websocket_ok boolean not null,
  webrtc_ok boolean not null,
  turn_ok boolean not null,
  decode_ok boolean not null,
  result text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table queue_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  status text not null,
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null,
  preflight_result_id uuid references preflight_results(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index queue_entries_one_active_per_user_uidx
  on queue_entries (user_id)
  where status in ('waiting', 'offered', 'accepted');
create index queue_fifo_idx on queue_entries (status, joined_at);

create table ride_offers (
  id uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references queue_entries(id),
  car_ids uuid[] not null,
  offered_at timestamptz not null,
  expires_at timestamptz not null,
  accepted_car_id uuid references cars(id),
  accepted_at timestamptz,
  status text not null,
  idempotency_key text not null unique
);

create table rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  car_id uuid not null references cars(id),
  state text not null,
  state_version integer not null default 1,
  purchased_seconds integer not null check (purchased_seconds >= 0),
  used_seconds integer not null default 0 check (used_seconds >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rides_one_active_per_user_uidx
  on rides (user_id)
  where state in ('CREATED','OFFERED','ACCEPTED','NEGOTIATING','ACTIVE','RECONNECT_GRACE','PAUSED_SITE_FAILOVER','ENDING');

create table ride_state_events (
  id bigserial primary key,
  ride_id uuid not null references rides(id),
  from_state text not null,
  to_state text not null,
  reason text not null,
  initiator text not null,
  version integer not null,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  unique (ride_id, version)
);

create table ride_time_segments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id),
  kind text not null,
  started_monotonic_us bigint not null,
  ended_monotonic_us bigint,
  measured_seconds integer,
  source text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table connection_attempts (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id),
  attempt integer not null check (attempt between 1 and 5),
  route text not null,
  started_at timestamptz not null,
  connected_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  unique (ride_id, attempt)
);

create table connection_summaries (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references rides(id),
  attempts integer not null check (attempts between 0 and 5),
  selected_route text,
  first_connected_at timestamptz,
  total_disconnects integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create table operator_actions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references users(id),
  ride_id uuid references rides(id),
  car_id uuid references cars(id),
  action text not null,
  reason text not null,
  idempotency_key text not null unique,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now()
);

create table compensation_entries (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id),
  ledger_entry_id uuid not null unique references ledger_entries(id),
  seconds integer not null check (seconds > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create table timing_passes (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  site_id uuid not null references sites(id),
  checkpoint text not null,
  transponder text not null,
  monotonic_us bigint not null,
  utc_time timestamptz not null,
  sequence bigint not null,
  signal_metadata jsonb not null default '{}'::jsonb,
  unique (provider, site_id, sequence)
);

create table laps (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id),
  season_id uuid not null references seasons(id),
  lap_number integer not null,
  duration_ms integer,
  status text not null,
  invalid_reason text,
  occurred_at timestamptz not null,
  unique (ride_id, lap_number)
);

create table lap_validation_events (
  id uuid primary key default gen_random_uuid(),
  lap_id uuid not null references laps(id),
  status text not null,
  reason text not null,
  actor_type text not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create table leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  user_id uuid not null references users(id),
  lap_id uuid not null references laps(id),
  duration_ms integer not null,
  status text not null,
  achieved_at timestamptz not null,
  unique (season_id, user_id)
);
create index leaderboard_rank_idx on leaderboard_entries (season_id, status, duration_ms, achieved_at);

create table moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  leaderboard_entry_id uuid not null references leaderboard_entries(id),
  moderator_id uuid not null references users(id),
  decision text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table season_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references seasons(id),
  snapshot jsonb not null,
  digest_sha256 text not null,
  created_at timestamptz not null default now()
);

create table prizes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  user_id uuid not null references users(id),
  rank integer not null,
  amount_minor integer not null,
  currency char(3) not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  ride_id uuid references rides(id),
  category text not null,
  description text not null,
  status text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table incident_comments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id),
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table camera_exports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id),
  ride_id uuid references rides(id),
  camera_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  object_uri text,
  status text not null,
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  severity text not null,
  code text not null,
  message text not null,
  correlation_id uuid,
  status text not null,
  fired_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table telemetry_summaries (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references rides(id),
  car_id uuid references cars(id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_target_time_idx on audit_events (target_type, target_id, occurred_at);

create table outbox_events (
  id uuid primary key,
  producer text not null,
  producer_sequence bigint not null,
  topic text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (producer, producer_sequence)
);
create index outbox_delivery_idx on outbox_events (status, next_attempt_at);

create table inbox_events (
  id uuid primary key,
  consumer text not null,
  producer text not null,
  producer_sequence bigint not null,
  idempotency_key text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  unique (consumer, idempotency_key),
  unique (consumer, producer, producer_sequence)
);
