# Dedicated TURN Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Coturn fallback, session-scoped TURN credentials, truthful route reporting, and Raspberry Pi ICE configuration while preserving the existing OpenVPN service.

**Architecture:** Coturn runs in an isolated host-network Docker Compose project on `turn.rcmania.live`. Web and gateway services derive 10-minute Coturn REST credentials from a file-mounted shared secret, and the browser/Pi use direct-first ICE configuration with TURN as fallback.

**Tech Stack:** TypeScript, Vitest, Node.js crypto/fs, Next.js, Fastify/WebSocket gateway, Python 3.11, pytest, aiortc, Docker Compose, Coturn, Certbot, UFW, systemd.

**Spec:** `docs/superpowers/specs/2026-08-18-dedicated-turn-server-design.md`

## Global Constraints

- TURN is fallback only; production WebRTC policy remains `all`.
- The TURN shared secret never appears in Git, images, browser source, or static ICE JSON.
- Credentials expire after 600 seconds and use Coturn REST HMAC-SHA1/Base64 format.
- OpenVPN UDP 1194 must remain available throughout deployment.
- Never run global Docker teardown/prune commands or restart Docker on the TURN VPS.
- Do not publish or commit until the user requests the release step.

---

### Task 1: Session-scoped TURN credentials

**Files:**
- Modify: `packages/device-auth/package.json`
- Modify: `packages/device-auth/src/index.ts`
- Modify: `packages/device-auth/src/index.test.ts`

**Interfaces:**
- Produces: `createTurnRestCredentials({ secret, subject, now, ttlSeconds })`
- Produces: `createSessionIceServers(templates, options): IceServer[]`

- [ ] Add failing tests for the exact Unix-expiry username and Base64 HMAC-SHA1 credential.
- [ ] Add failing tests that STUN entries remain anonymous, TURN entries receive temporary credentials, static credentials are rejected, and missing secrets fail closed.
- [ ] Run `pnpm --filter @rc/device-auth test` and confirm the new tests fail for missing exports.
- [ ] Implement the smallest credential and ICE-template helpers with 60-3600 second TTL validation.
- [ ] Run the package tests and typecheck.

### Task 2: Web drive-session issuance

**Files:**
- Modify: `apps/web/app/drive-session-ticket.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.test.ts`
- Modify: `apps/web/package.json`
- Modify: `infra/compose/compose.vps-web.yaml`

**Interfaces:**
- Produces: `createPublicIceServers(subject, now, env, readFile)`
- Consumes: `TURN_SHARED_SECRET_FILE`, `TURN_CREDENTIAL_TTL_SECONDS`, and URL-only `GATEWAY_ICE_SERVERS_JSON`

- [ ] Add a failing endpoint test proving a fresh per-session credential is returned and no static credential dependency is accepted.
- [ ] Add failing configuration tests for missing/short secret files and invalid ICE JSON.
- [ ] Run the focused web tests and confirm the expected failures.
- [ ] Implement file-secret loading, schema validation, and per-session issuance.
- [ ] Mount the same Docker secret into the web and gateway services without placing its value in Compose environment data.
- [ ] Run focused web tests and typecheck.

### Task 3: Gateway issuance for the Pi

**Files:**
- Modify: `apps/gateway/src/config.ts`
- Modify: `apps/gateway/src/server.ts`
- Modify: `apps/gateway/src/server.test.ts`
- Modify: `apps/gateway/src/infra.test.ts`
- Modify: `apps/gateway/package.json`

**Interfaces:**
- `GatewayConfig.iceServerTemplates: IceServer[]`
- `GatewayConfig.turnSharedSecret?: string`
- `GatewayConfig.turnCredentialTtlSeconds: number`

- [ ] Add failing config tests for URL-only templates and file-mounted secrets.
- [ ] Add a failing WebSocket pairing test proving `session.start` sent to the device contains a short-lived TURN credential scoped to the session.
- [ ] Run gateway tests and confirm the failures.
- [ ] Generate ICE credentials at browser attachment time and pass them to both peers.
- [ ] Run gateway tests and typecheck.

### Task 4: Browser route detection

**Files:**
- Modify: `apps/web/app/ride-session-client.ts`
- Modify: `apps/web/app/ride-session-client.test.ts`
- Modify: `apps/web/app/ride-connection-attempt.ts`
- Modify: `apps/web/app/ride-connection-attempt.test.ts`
- Modify: `apps/web/app/real-ride-screen.tsx`

**Interfaces:**
- Produces: connection state `DIRECT | TURN | CONNECTED`
- Produces: progress events `webrtc.direct | webrtc.turn | webrtc.connected`

- [ ] Add failing tests for selected direct and relay candidate pairs plus unavailable stats.
- [ ] Add failing loading-attempt tests proving both `DIRECT` and `TURN` can satisfy transport readiness.
- [ ] Run focused tests and confirm the failures.
- [ ] Inspect `RTCPeerConnection.getStats()` after connection, classify relay pairs, and avoid claiming direct when stats are incomplete.
- [ ] Update ride UI state styling and loading messages.
- [ ] Run focused web tests and typecheck.

### Task 5: Raspberry Pi ICE configuration

**Files in `C:/Users/user/Documents/github/tether-rally-mjx`:**
- Modify: `pi-agent/rc_pi_agent/webrtc.py`
- Modify: `pi-agent/rc_pi_agent/main.py`
- Modify: `pi-agent/tests/test_webrtc.py`

**Interfaces:**
- Produces: `parse_ice_servers(value) -> tuple[IceServerConfig, ...]`
- `DrivePeer(..., ice_servers)` constructs aiortc `RTCConfiguration`

- [ ] Add failing parser tests for string/list URLs, temporary credentials, limits, and malformed input.
- [ ] Add a failing test proving `DrivePeer` passes parsed servers into aiortc.
- [ ] Run `pytest -q pi-agent/tests/test_webrtc.py` and confirm failures.
- [ ] Implement strict parsing and aiortc mapping.
- [ ] Pass `session.start.iceServers` from the gateway handler and fail closed on invalid data.
- [ ] Run focused and complete Pi tests.

### Task 6: Isolated Coturn deployment

**Files:**
- Modify: `infra/compose/compose.turn.yaml`
- Modify: `infra/compose/coturn/turnserver.conf.template`
- Create: `infra/compose/coturn/entrypoint.sh`
- Create: `infra/turn/rcmania-turn-renew.service`
- Create: `infra/turn/rcmania-turn-renew.timer`
- Create: `infra/turn/configure-firewall.sh`
- Create: `infra/turn/verify-turn.sh`
- Modify: `apps/gateway/src/infra.test.ts`

**Interfaces:**
- Docker secret path: `/run/secrets/turn_shared_secret`
- Certificate paths: `/etc/letsencrypt/live/turn.rcmania.live/fullchain.pem` and `privkey.pem`
- Relay range: UDP 49160-49259

- [ ] Extend the infrastructure test first to require pinned Coturn, TLS 443, the bounded relay range, secret-file entrypoint, resource limits, log rotation, and OpenVPN-preserving firewall rules.
- [ ] Run the infrastructure test and confirm it fails.
- [ ] Implement the Compose service, config template, tmpfs secret injection, certificate mounts, health check, and renewal units.
- [ ] Implement an idempotent firewall script that allows SSH/OpenVPN before enabling UFW and never changes Docker/OpenVPN state.
- [ ] Implement a smoke-test script for DNS, UDP/TCP/TLS listeners, certificate identity, and an authenticated allocation.
- [ ] Validate Compose rendering with a dummy secret file and run the infrastructure test.

### Task 7: Runbook and release verification

**Files:**
- Rewrite: `docs/runbooks/turn-enable.md`
- Modify: `docs/deployment-vps.md`

- [ ] Document exact preparation, secret creation/distribution, Certbot issuance, OpenVPN pre/post checks, TURN deployment, forced-relay acceptance, fallback validation, monitoring, and rollback commands.
- [ ] Run secret scans over tracked changes and confirm no credential material is present.
- [ ] Run `pnpm --filter @rc/device-auth test`, gateway tests, web tests, full `pnpm typecheck`, and build.
- [ ] Run the complete `pytest -q pi-agent` suite in the Pi repository.
- [ ] Record any production-only checks that remain for the later approved deployment step.
