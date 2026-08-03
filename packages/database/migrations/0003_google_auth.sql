alter table users
  add column email_verified_at timestamptz;

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_sessions_user_idx on auth_sessions(user_id);
create index auth_sessions_expiry_idx on auth_sessions(expires_at);

create table account_balances (
  user_id uuid primary key references users(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
