# Runbook: PostgreSQL restore

Production requires Cloud SQL regional HA, automatic backups, and PITR. At least
quarterly, restore to an isolated project from a timestamp no older than five
minutes before the drill, run migrations in validation mode, compare ledger
invariants and row counts, then exercise read-only API checks.

Pass criteria are measured RPO at most five minutes and RTO at most four hours.
Terraform configuration is not evidence; retain timestamps, operation IDs,
checksums, and reviewer sign-off from the real drill.
