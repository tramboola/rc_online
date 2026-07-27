# ADR 0002: Mock mode is a startup-fatal production violation

Status: accepted, 2026-07-25.

Simulation adapters implement production interfaces and use real PostgreSQL,
Redis, queues, ledger, and state machines. When `NODE_ENV=production`, any
`MOCK_*` truthy flag, `SIMULATION_SCENARIO`, or mock/simulator/loop/mailpit/
mediamtx provider value terminates startup. Production never silently falls
back when a real provider is unavailable.
