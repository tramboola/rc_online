alter table firmware_versions
  add column artifact_url text,
  add column artifact_size_bytes integer,
  add column runtime_generation integer,
  add column published_at timestamptz;

alter table firmware_versions
  add constraint firmware_versions_pi_agent_artifact_check check (
    component_kind <> 'pi-agent' or (
      artifact_url is not null
      and artifact_url ~ '^https://'
      and artifact_size_bytes between 1 and 8388608
      and runtime_generation between 1 and 32767
      and published_at is not null
      and digest_sha256 ~ '^[0-9a-f]{64}$'
      and length(signature) between 80 and 128
    )
  );

create table device_update_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  firmware_version_id uuid not null references firmware_versions(id),
  status text not null default 'pending',
  attempt_count integer not null default 0,
  failure_reason text,
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_update_jobs_status_check check (
    status in ('pending', 'downloading', 'applying', 'succeeded', 'failed')
  ),
  constraint device_update_jobs_attempt_count_check check (attempt_count between 0 and 1),
  constraint device_update_jobs_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 256
  )
);

create unique index device_update_jobs_one_active_device_uidx
  on device_update_jobs(device_id)
  where status in ('pending', 'downloading', 'applying');

create index device_update_jobs_device_requested_idx
  on device_update_jobs(device_id, requested_at desc);
