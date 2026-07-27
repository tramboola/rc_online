# Security policy and invariants

Report vulnerabilities privately through GitHub Security Advisories. Do not
include customer data, device certificates, TURN credentials, or payment
secrets in an issue.

Security invariants:

- production rejects all mock and simulator provider flags;
- payment webhooks are authenticated from the raw body before persistence;
- every external event is deduplicated before asynchronous processing;
- wallet balance is derived only from immutable PostgreSQL ledger entries;
- control commands are ride-bound, sequenced, age-bounded, checksum-protected,
  and subordinate to operator stop;
- edge and Pi identities use unique certificates and outbound connections;
- production secrets belong only in Google Secret Manager;
- state transitions and administrative adjustments require an actor, reason,
  correlation ID, version, and idempotency key.

Critical reportable findings include unauthorized vehicle control, bypass of
operator stop, fraudulent time credit/debit, forged ride grants or device
identity, and cross-user takeover of an active ride.
