# Runbook: Stripe DLQ or reconciliation mismatch

1. Do not manually mutate ledger rows.
2. Confirm the event was signature-verified and persisted once.
3. Compare Stripe event/session/invoice state with `stripe_events`,
   `wallet_lots`, and ledger idempotency keys.
4. Replay the stored event through the audited worker replay path. A repeat must
   be a no-op.
5. For a genuine correction, append a compensating ledger adjustment with
   business-admin identity, reason, and correlation ID.
