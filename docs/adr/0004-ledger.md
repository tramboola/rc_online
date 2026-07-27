# ADR 0004: PostgreSQL append-only time ledger

Status: accepted, 2026-07-25.

Seconds are money-equivalent. Balance is the sum of immutable ledger entries,
debits consume expiring lots FIFO, and every mutation has an idempotency key.
Redis may accelerate queue and presence data but never establishes balance or
ride settlement. Adjustments are compensating entries with actor and reason.
