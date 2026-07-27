# Runbook: edge offline

1. Block new rides and send stop-all through every remaining control path.
2. Confirm Pi/ESP32 watchdogs entered neutral; obtain an on-site visual check.
3. Check host power, WAN failover, Docker service, disk pressure, certificate
   expiry, SQLite WAL integrity, and outbox backlog.
4. Restore from the signed Ubuntu Compose bundle or known-good image. Do not
   delete the outbox; replay it idempotently after cloud connectivity returns.
5. Require operator recovery and safety checks before returning any car to
   `AVAILABLE`.
