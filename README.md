# RC Racing Platform

RC Racing is a cloud, edge, and device-control platform for booking and driving
real RC cars through a browser. This repository contains the production-shaped
services and contract-compatible simulators required to exercise the complete
software journey without physical cars.

## Current status

The codebase is a **simulation candidate**. User-authorized Chromium visual QA
has passed. Hardware and legal gates are waived/deferred only for internal
simulation; they are not factual passes and do not permit real vehicles,
payments, public streaming, prizes, or a `LAUNCH READY` label. The exact
disposition is maintained in
[`docs/acceptance/SIMULATION_STATUS_RU.md`](docs/acceptance/SIMULATION_STATUS_RU.md).

## Architecture

- `apps/web` — Next.js App Router customer, driver, operator, and admin UI
- `apps/api` — NestJS/Fastify REST, scenario controller, billing intake
- `apps/worker` — BullMQ payment processing and ledger credits
- `apps/edge` — Fastify site edge, safety gate, SQLite WAL outbox
- `packages/contracts` — Zod contracts and committed OpenAPI v1
- `packages/domain` — state machines, FIFO queue, rides, append-only time ledger
- `packages/database` — Drizzle schema, versioned SQL migrations, deterministic seed
- `infra/compose` — PostgreSQL, Redis, TURN, media, mail, observability, simulators
- `infra/terraform` — isolated staging/production GCP projects
- `../tether-rally-mjx` — independent sibling Git repository cloned from
  upstream with its history and MIT attribution, plus Pi/ESP32/simulator
  additions

## Prerequisites

- Node.js 22 LTS and pnpm 10
- Docker Desktop with WSL2 for the integrated local environment
- FFmpeg 7+ for media checks
- Python 3.11 for Pi/timing simulators
- PlatformIO for native and ESP32-C3 firmware tests

## Local workflow

```powershell
pnpm install
pnpm check
docker compose -f infra/compose/compose.yaml --profile core --profile sim --profile obs up --build
pnpm db:seed
pnpm dev:mock
```

The application endpoints are web `:3000`, API `:3001`, edge `:3002`, Grafana
`:3003`, Mailpit `:8025`, and MediaMTX HLS `:8888`.

The mock mode uses real PostgreSQL, Redis, BullMQ, ledger, migrations, state
machines, REST, and edge outbox. Production startup rejects every mock or
simulator provider flag; see `packages/config`.

## Anonymous viewer count

The public viewer count is an anonymous, process-local count of currently open
viewer WebSocket connections. The browser connects only through the same-origin
path `/gateway/v1/viewers`; Nginx forwards that path to the gateway as
`/v1/viewers` and upgrades the connection as WebSocket.

This design deliberately creates no viewer ID, browser cookie, or browser
storage, and it sends no heartbeat. Viewer presence has no HTTP route and does
not persist raw request metadata. The count is therefore valid only with a
single gateway instance. Do not load-balance gateway replicas for this feature
until a shared aggregation design is introduced.

## Scenario controller

`POST /v1/simulation/scenarios/:scenario` accepts:

`normal`, `webrtc-five-failures`, `tab-reconnect`, `pi-offline`,
`esp32-offline`, `uart-corrupt`, `battery-low`, `battery-critical`,
`wan-failover`, `redis-reset`, `timing-offline`, `camera-offline`,
`public-stream-offline`, `disk-full`, and `power-loss`.

## Repository policy

GitHub Issues are the only task tracker. Conventional commits, CODEOWNERS,
Dependabot, security scanning, SBOM generation, and required CI checks are
defined in this repository. Publishing changes, creating the remote fork, and
enabling branch protection are deliberate maintainer actions and are not
performed by a local build.
