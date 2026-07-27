# RC Racing repository threat model

## Overview

This repository operates internet-facing commerce and remote control of
physical vehicles. Primary runtime surfaces are Next.js (`apps/web`), the
Nest/Fastify API and Stripe intake (`apps/api`), asynchronous settlement
(`apps/worker`), the site edge and SQLite outbox (`apps/edge`), data contracts
and PostgreSQL migrations (`packages/*`), and Pi/ESP32 control code in the
independent `tether-rally-mjx` repository. Infrastructure code provisions GCP
and the local simulation environment. Tests, reference images, and
documentation are not production runtime surfaces.

The safety consequence makes authorization and command integrity more severe
than in an ordinary game. Seconds in the ledger are money-equivalent; camera
and account data are privacy-sensitive.

## Threat Model, Trust Boundaries, and Assumptions

Trust boundaries:

1. Untrusted browser and public internet to Cloud Run/load balancer.
2. Stripe/Google/notification provider webhooks or callbacks to the API.
3. Cloud API/Redis signaling to an outbound-authenticated site edge.
4. Edge to Pi over a unique device identity and ride grant.
5. Pi to ESP32 over UART, where electrical access is site-controlled but data
   corruption, stale packets, and compromised Pi output are expected.
6. Operators/admins to privileged functions and immutable audit/ledger storage.
7. GitHub Actions to GCP through Workload Identity Federation.

Attacker-controlled input includes REST/WebSocket payloads, browser media and
control negotiation, OAuth state returns, webhook traffic before verification,
nicknames, promo codes, timing input from untrusted adapters, and packet timing.
Operator-controlled input includes stop/recovery, calibration, moderation, and
ledger adjustments. Developer-controlled input includes migrations, Terraform,
container images, firmware, and signed updates.

Assumptions: TLS terminates at a controlled load balancer; edge/Pi certificates
and signing keys are not in source control; operator accounts use strong
authentication; physical actuator limits and emergency stop are independently
validated; legal eligibility and payment activation are external launch gates.

## Attack Surface, Mitigations, and Attacker Stories

- Identity/session: login CSRF, nonce/state replay, session fixation, cookie
  theft, XSS, weak RBAC, and account enumeration could take over a queue or
  ride. Required controls are HttpOnly/Secure/SameSite cookies, short sessions,
  CSRF protection, unique normalized nicknames, explicit role checks, CSP, and
  audit logs.
- Billing/ledger: forged or replayed Stripe events, event-order races, metadata
  substitution, double credits, or mutable history could create money-
  equivalent time. The code requires raw-body signature verification,
  persistent event dedupe, BullMQ retry/DLQ, database transactions, unique
  idempotency keys, immutable ledger triggers, FIFO lots, and reconciliation.
- Queue/ride: cross-tab races, predictable identifiers, stale offers, or forged
  ride grants could attach an attacker to another car. Required controls are
  database uniqueness for one active queue/ride, 30-second offers, 90-second
  Ed25519 ride grants with audience/JTI/ride/user/car/site claims, and
  versioned transitions.
- WebRTC/signaling: unauthorized SDP/ICE exchange, TURN abuse, SSRF-like ICE
  candidates, signaling replay, or DataChannel flooding could leak media or
  control a car. Authenticate each signaling message to the ride, rate limit,
  expire grants, restrict TURN credentials, use instance-independent snapshots,
  and discard old fast-control commands.
- Edge/device: compromised cloud traffic, replay, wrong ride, clock anomalies,
  UART corruption, lost focus, dead Pi, or update compromise could retain
  throttle. Edge and firmware bind ride ID, sequence, monotonic age and bounds;
  CRC/COBS detects corruption; watchdog/neutral timeout and latched operator
  stop fail safe; unique certificates and signed canary updates limit blast
  radius. Native tests are not physical timing evidence.
- Timing/media: duplicate passes can falsify rankings; RTSP/recording access can
  expose bystanders. Normalize and dedupe checkpoint sequences, moderate top
  results, isolate camera networks, authorize exports, audit retrieval, enforce
  retention, and disable public composition first under load.
- Infrastructure/supply chain: secret commits, poisoned dependencies, excessive
  service accounts, public databases, image drift, or migration rollback can
  compromise all sites. Controls include Secret Manager, WIF, least-privilege
  accounts, private VPC egress, pinned runtime majors, Dependabot, CodeQL,
  Semgrep, gitleaks, Trivy, SBOM, immutable artifacts, and a migration job.

Realistic attacker stories are an internet user trying to steal ride time, take
over an offered ride, abuse TURN, or flood signaling; a compromised user session
sending control outside its ride; a malicious operator hiding an adjustment;
and a compromised Pi replaying unsafe UART commands. Nation-state compromise of
Google Cloud or physical invasive attacks on an ESP32 are out of scope for MVP
but must still fail toward neutral where feasible.

## Severity Calibration (Critical, High, Medium, Low)

- Critical: unauthenticated or cross-account vehicle control; bypass of a
  latched operator stop; arbitrary ledger credit/debit at scale; forged
  production update or device identity enabling fleet control.
- High: account takeover that reaches an active ride; webhook replay causing
  repeat credits; cross-site camera access; privilege escalation to operator or
  business admin; remote secret exfiltration.
- Medium: queue manipulation without vehicle control; limited leaderboard
  fraud; denial of one non-active car; retention bypass limited to an authorized
  operator; missing audit correlation without history mutation.
- Low: non-sensitive version disclosure, UI-only spoofing with no authenticated
  action, local-development denial of service, or test-only findings that cannot
  enter a production artifact.

Repository: github.com/tramboola/rc_online
Version: working-tree-snapshot-2026-07-25
