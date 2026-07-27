# Observability contract

All services emit one-line JSON with `timestamp`, `level`, `service`,
`environment`, `event`, and `correlation_id`. When applicable the same record
also carries `user_id`, `ride_id`, `car_id`, `site_id`, `edge_event_id`,
`stripe_event_id`, `uart_sequence`, and `state_version`. Passwords, tokens,
cookies, authorization headers, Stripe payload secrets, certificates, direct
contact/payment identifiers, SDP, and private ICE candidates are redacted.

Correlation IDs are accepted only as bounded UUIDs; invalid external values are
replaced. REST responses echo the ID. WebSocket envelopes, outbox/inbox events,
worker jobs, timing passes, ledger entries, operator actions, and incidents
preserve it.

Local telemetry uses OpenTelemetry to Prometheus/Grafana/Loki/Tempo. Dashboards
must cover:

- API RED: request rate, error ratio, duration p50/p95/p99;
- site USE: CPU, memory, disk, UART errors, queue depth, outbox age;
- RTC: setup success, direct/TURN split, attempts, reconnects, RTT, packet loss;
- business: queue wait, offer expiry, ride success, compensation rate, paid
  seconds granted/consumed, Stripe DLQ/reconciliation delta;
- safety: neutral transitions, operator stops, stale/replay/corrupt command
  rejects, battery blocks, edge/Pi/ESP32 health.

Production Sentry is enabled only after staging exists and a real captured test
event is verified. Local source maps or DSNs are never committed.
