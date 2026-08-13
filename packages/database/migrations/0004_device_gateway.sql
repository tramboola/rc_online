alter table devices
  add column agent_version text,
  add column health jsonb not null default '{}'::jsonb,
  add column connected_at timestamptz;

create index devices_car_presence_idx
  on devices (car_id, state, last_seen_at);

create table device_enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index device_enrollment_tokens_open_idx
  on device_enrollment_tokens (expires_at)
  where consumed_at is null;

create table device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  secret_hash text not null unique,
  status text not null default 'active',
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_authenticated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index device_credentials_one_active_device_uidx
  on device_credentials (device_id)
  where status = 'active' and revoked_at is null;

create table drive_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  car_id uuid not null references cars(id),
  status text not null default 'created',
  expires_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create unique index drive_sessions_one_active_car_uidx
  on drive_sessions (car_id)
  where status in ('created', 'negotiating', 'active');
create unique index drive_sessions_one_active_user_uidx
  on drive_sessions (user_id)
  where status in ('created', 'negotiating', 'active');
create index drive_sessions_expiry_idx on drive_sessions (expires_at);
