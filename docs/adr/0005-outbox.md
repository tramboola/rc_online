# ADR 0005: Transactional outbox and idempotent inbox

Status: accepted, 2026-07-25.

Cloud writes domain data and outbox events in one PostgreSQL transaction. Edge
uses SQLite WAL with full synchronous writes and producer sequences. Consumers
deduplicate stable event IDs and idempotency keys. Acknowledgement changes retry
status but never rewrites event payload or financial history.
