alter table drive_sessions
  add column queue_entry_id uuid references queue_entries(id);

create unique index drive_sessions_queue_entry_uidx
  on drive_sessions (queue_entry_id)
  where queue_entry_id is not null;

update queue_entries
set status = 'expired', expires_at = least(expires_at, now()), updated_at = now()
where status = 'accepted';

drop index if exists queue_entries_one_active_per_user_uidx;

with ranked_live_entries as (
  select
    id,
    row_number() over (partition by user_id order by joined_at, id) as live_rank
  from queue_entries
  where status in ('waiting', 'offered')
)
update queue_entries
set status = 'expired', expires_at = least(expires_at, now()), updated_at = now()
from ranked_live_entries
where queue_entries.id = ranked_live_entries.id
  and ranked_live_entries.live_rank > 1;

create unique index queue_entries_one_live_user_uidx
  on queue_entries (user_id)
  where status in ('waiting', 'offered');
