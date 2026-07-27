create or replace function reject_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger_entries is append-only; corrections require a compensating entry';
end;
$$;

create trigger ledger_entries_reject_mutation
before update or delete on ledger_entries
for each row execute function reject_ledger_mutation();

revoke update, delete on ledger_entries from public;
