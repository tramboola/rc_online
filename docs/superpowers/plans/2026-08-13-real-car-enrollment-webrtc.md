# RC Mania Real Car Enrollment and Direct WebRTC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enroll `RC Mania One`, keep its availability synchronized from a Raspberry Pi heartbeat, and let the production administrator drive it with direct 720p WebRTC video and GPIO controls.

**Architecture:** A dedicated VPS gateway authenticates outbound Pi connections, persists presence, issues isolated signaling sessions, and relays only WebRTC negotiation. Next.js creates admin-only drive sessions and renders the real WebRTC client. A single Python systemd service on the Pi owns IMX708 capture and direct GPIO18/GPIO19 control with local watchdog neutralization.

**Tech Stack:** Next.js 16, React 19, Node.js 22, Fastify 5, WebSocket, PostgreSQL 16, Drizzle ORM, Vitest, Docker Compose, Nginx, Python 3.13, aiohttp, aiortc, Picamera2, lgpio, systemd.

## Global Constraints

- Preserve `docs/superpowers/plans/2026-08-13-product-direction-aware-brake-nitro-sync.md` without staging or editing it.
- Use English commit messages.
- Work directly on the existing RC `main` only because the user explicitly approved direct main integration.
- Preserve the clean `codex/pi-direct-pwm` branch in `tether-rally-mjx` and commit Pi changes there.
- Raspberry Pi owns GPIO18 steering and GPIO19 ESC directly; no ESP32 exists.
- Keep the traction battery disconnected for all automated and remote work.
- Target 1280x720 at 60 fps and report/fall back to 30 fps when 60 is not sustainable.
- Do not expose an inbound Pi service to the Internet.
- Direct WebRTC is first; TURN remains disabled but has complete templates.
- Healthy Pi presence automatically sets `RC Mania One` to `AVAILABLE`.
- Missing heartbeat for 15 seconds fails closed to `OFFLINE`.
- Never store plaintext device secrets, enrollment codes, or browser tickets in PostgreSQL.
- Never delete the production PostgreSQL container or volume.
- Restore Raspberry Pi overlayroot only after the persistent installation and reconnection tests pass.

---

### Task 1: Gateway contracts and persistent device model

**Files:**
- Create: `packages/contracts/src/device-gateway.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/device-gateway.test.ts`
- Create: `packages/database/migrations/0004_device_gateway.sql`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/migrations.test.ts`

**Interfaces:**
- Produces: `DeviceHealth`, `GatewayClientMessage`, and `GatewayServerMessage` Zod schemas.
- Produces: `deviceEnrollmentTokens`, `deviceCredentials`, and `driveSessions` Drizzle tables.
- Extends: `devices` with `agentVersion`, `health`, and credential-independent presence fields.

- [ ] **Step 1: Write failing contract and migration tests**

Test exact rejection of unknown message types, out-of-range fps/temperature, missing session IDs, and migration presence of the three new tables plus credential hash fields.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/contracts test`

Run: `pnpm.cmd --filter @rc/database test`

Expected: FAIL because the gateway contracts and migration do not exist.

- [ ] **Step 3: Add versioned contracts**

Define messages with a literal `v: 1`, bounded strings, UUID identifiers, and discriminated unions:

```ts
export const deviceHealthSchema = z.object({
  cameraReady: z.boolean(),
  gpioReady: z.boolean(),
  watchdogReady: z.boolean(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(2160),
  fps: z.number().int().min(1).max(120),
  cpuTemperatureC: z.number().min(-20).max(120).nullable(),
  wifiSignalDbm: z.number().int().min(-120).max(0).nullable(),
});
```

Messages cover authenticate, heartbeat, offer, answer, ICE candidate, session start/end, neutral, and error.

- [ ] **Step 4: Add the migration and Drizzle schema**

Create one-time enrollment hashes with expiry/consumption, device credential hashes with revocation, and drive sessions with user/car/status/expiry. Add indexes for unconsumed enrollment lookup, active device credentials, and active car drive sessions.

- [ ] **Step 5: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/contracts test && pnpm.cmd --filter @rc/database test && pnpm.cmd --filter @rc/database typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/database
git commit -m "Add physical car gateway data model"
```

### Task 2: Shared credential and ticket primitives

**Files:**
- Create: `packages/device-auth/package.json`
- Create: `packages/device-auth/tsconfig.json`
- Create: `packages/device-auth/src/index.ts`
- Create: `packages/device-auth/src/index.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `hashOpaqueSecret(secret, pepper): string`.
- Produces: `verifyOpaqueSecret(secret, expectedDigest, pepper): boolean`.
- Produces: `signBrowserTicket(payload, secret, now?): string`.
- Produces: `verifyBrowserTicket(token, secret, now?): BrowserTicketPayload`.
- Produces: `generateOpaqueSecret(bytes?: number): string`.

- [ ] **Step 1: Write failing security tests**

Cover deterministic hashing, timing-safe equality, tampering, wrong secret, expiry, future-issued tickets, wrong audience, and a 32-byte default secret.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/device-auth test`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement dependency-free Node crypto primitives**

Use SHA-256 HMAC with a server pepper for random opaque secrets and an HMAC-signed base64url JSON envelope for browser tickets. Require `aud: "rcmania-gateway"`, `exp`, `iat`, user ID, car ID, drive-session ID, and role `admin`.

- [ ] **Step 4: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/device-auth test && pnpm.cmd --filter @rc/device-auth typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/device-auth pnpm-lock.yaml
git commit -m "Add gateway credential primitives"
```

### Task 3: Device enrollment and presence gateway

**Files:**
- Create: `apps/gateway/package.json`
- Create: `apps/gateway/tsconfig.json`
- Create: `apps/gateway/src/config.ts`
- Create: `apps/gateway/src/store.ts`
- Create: `apps/gateway/src/postgres-store.ts`
- Create: `apps/gateway/src/presence.ts`
- Create: `apps/gateway/src/provision-car.ts`
- Create: `apps/gateway/src/server.ts`
- Create: `apps/gateway/src/presence.test.ts`
- Create: `apps/gateway/src/server.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `GatewayStore` with enrollment, credential authentication, heartbeat, drive-session, and state-transition methods.
- Produces: `PresenceRegistry` with a five-second heartbeat model and 15-second expiry.
- Produces: `createGatewayServer(config, store)`.
- Produces: CLI `pnpm --filter @rc/gateway provision-car --slug rc-mania-one --name "RC Mania One"` that prints one enrollment code exactly once.

- [ ] **Step 1: Write failing presence tests**

Assert healthy heartbeat transitions to `AVAILABLE`, any camera/GPIO/watchdog failure transitions to `SAFETY_BLOCKED`, disconnect and stale sweep transition to `OFFLINE`, and administrative blocking wins over health.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/gateway test`

- [ ] **Step 3: Implement the store and presence registry**

Use transactions for one-time enrollment consumption and device creation. Update `devices.last_seen_at`, bounded health JSON, and car state together. Do not let a heartbeat clear `admin_blocked`.

- [ ] **Step 4: Implement HTTP enrollment and health endpoints**

Expose:

```text
GET  /health/live
GET  /health/ready
POST /v1/enroll
GET  /v1/socket   (WebSocket upgrade)
```

`POST /v1/enroll` accepts the code, serial number, agent version, and public capabilities, then returns `deviceId`, `deviceSecret`, `carId`, and gateway URL once.

- [ ] **Step 5: Implement device WebSocket authentication and heartbeat**

Require the first message within five seconds to be `device.authenticate`. Close unauthenticated, replayed, revoked, oversized, malformed, or idle connections. Redact secrets from logs.

- [ ] **Step 6: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/gateway test && pnpm.cmd --filter @rc/gateway typecheck && pnpm.cmd --filter @rc/gateway build`

- [ ] **Step 7: Commit**

```bash
git add apps/gateway pnpm-lock.yaml
git commit -m "Add device enrollment and presence gateway"
```

### Task 4: Drive-session authorization and isolated signaling

**Files:**
- Create: `apps/gateway/src/sessions.ts`
- Create: `apps/gateway/src/sessions.test.ts`
- Modify: `apps/gateway/src/server.ts`
- Create: `apps/web/app/api/admin/drive-sessions/route.ts`
- Create: `apps/web/app/api/admin/drive-sessions/route.test.ts`
- Create: `apps/web/app/drive-session-store.ts`
- Create: `apps/web/app/drive-session-ticket.ts`
- Modify: `apps/web/auth/vps-compose.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/drive-sessions` with `{ carId }` and `{ sessionId, ticket, gatewayUrl, iceServers }`.
- Produces: `SessionRegistry` that pairs one administrator browser with one authenticated device.
- Relays: offer, answer, ICE candidate, session start, session end, and neutral messages only within the matching drive-session/car pair.

- [ ] **Step 1: Write failing authorization and isolation tests**

Cover signed-out rejection, non-admin rejection, stale/offline car rejection, duplicate active controller rejection, ticket expiry, cross-car signaling rejection, and neutral delivery on browser disconnect.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/api/admin/drive-sessions/route.test.ts`

Run: `pnpm.cmd --filter @rc/gateway exec vitest run src/sessions.test.ts`

- [ ] **Step 3: Implement admin session creation**

Verify same-origin POST, Auth.js administrator role, fresh online device, no active session, and database transaction. Create a five-minute session and a two-minute connection ticket.

- [ ] **Step 4: Implement signaling isolation**

Browser WebSockets authenticate with a first-message ticket. Pair only with the device bound to the ticket car. Forward only validated signaling messages. End and neutralize on browser disconnect or expiry.

- [ ] **Step 5: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/web test && pnpm.cmd --filter @rc/gateway test && pnpm.cmd --filter @rc/web typecheck && pnpm.cmd --filter @rc/gateway typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/gateway apps/web
git commit -m "Add administrator drive signaling sessions"
```

### Task 5: Real browser WebRTC ride client

**Files:**
- Create: `apps/web/app/ride-session-client.ts`
- Create: `apps/web/app/ride-session-client.test.ts`
- Create: `apps/web/app/real-ride-screen.tsx`
- Create: `apps/web/app/real-ride-screen.test.tsx`
- Modify: `apps/web/app/control-loop.ts`
- Modify: `apps/web/app/control-loop.test.ts`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: `createAdminDriveSession(carId)`.
- Produces: `RideSessionClient` that owns gateway signaling and `RTCPeerConnection`.
- Binds: `control-fast` and `control-reliable` to `BrowserControlLoop`.
- Renders: the actual remote MediaStream, connection mode, actual video mode, and explicit arm/end controls.

- [ ] **Step 1: Write failing browser tests**

Cover offer creation, signaling serialization, remote track binding, ordered/unordered channel settings, disabled controls before arm, neutral on blur/hidden/Escape/unmount, and admin queue navigation carrying the selected real car.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/ride-session-client.test.ts app/real-ride-screen.test.tsx app/control-loop.test.ts`

- [ ] **Step 3: Implement the session and signaling client**

Use same-origin `/gateway/v1/socket`; send the ticket only in the first WebSocket message. Configure STUN from the session response and collect trickle ICE candidates.

- [ ] **Step 4: Implement the real ride UI**

Replace the mock video only for the administrator real session. Display connection states `CONNECTING`, `DIRECT`, `RELAY`, and `DISCONNECTED`, plus reported resolution/fps. Remove fake battery and lap data from the live canary screen.

- [ ] **Step 5: Update control frames**

Send version, session ID, sequence, axes, brake, Nitro, and armed. Do not send browser `performance.now()` as a value the Pi compares with its own clock.

- [ ] **Step 6: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/web test && pnpm.cmd --filter @rc/web typecheck && pnpm.cmd --filter @rc/web build`

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "Connect administrator ride UI to real WebRTC"
```

### Task 6: Single-owner Raspberry Pi WebRTC agent

**Repository:** `C:/Users/user/Documents/github/tether-rally-mjx`

**Files:**
- Modify: `pi-agent/rc_pi_agent/config.py`
- Modify: `pi-agent/rc_pi_agent/control.py`
- Modify: `pi-agent/rc_pi_agent/runtime.py`
- Create: `pi-agent/rc_pi_agent/gateway.py`
- Create: `pi-agent/rc_pi_agent/video.py`
- Create: `pi-agent/rc_pi_agent/webrtc.py`
- Rewrite: `pi-agent/rc_pi_agent/main.py`
- Modify: `pi-agent/pyproject.toml`
- Modify: `pi-agent/tests/test_control.py`
- Create: `pi-agent/tests/test_gateway.py`
- Create: `pi-agent/tests/test_video.py`
- Create: `pi-agent/tests/test_webrtc.py`
- Modify: `image/rc-pi-agent.service`
- Modify: `image/rc-pi-agent.env.example`
- Modify: `image/scripts/install-pi-agent.sh`
- Modify: `pi-agent/tests/test_install_artifacts.py`

**Interfaces:**
- Produces: `GatewayClient` with enrollment/authentication/reconnect/heartbeat.
- Produces: `CameraVideoTrack` with 720p60 attempt and 720p30 fallback.
- Produces: `DrivePeer` with two DataChannels and direct video.
- Produces: one systemd service and one GPIO owner.

- [ ] **Step 1: Write failing Pi tests**

Cover frame bounds, sequence replay, wrong session, arm gating, brake/reverse, Nitro, 200 ms local watchdog, gateway reconnect neutral, offer/answer routing, video fallback, credential file permissions, and the exact systemd entry point.

- [ ] **Step 2: Run RED verification**

Run: `python -m pytest -q pi-agent`

- [ ] **Step 3: Synchronize the proven direct GPIO semantics**

Port the direction-aware brake/reverse and Nitro behavior from the verified RC hardware bench implementation. Keep all output adapters injectable so tests never claim real GPIO.

- [ ] **Step 4: Implement camera and WebRTC adapters**

Use Picamera2 for RGB frames and aiortc for the video track/DataChannels. Attempt 1280x720x60, measure/report the selected configuration, and retry at 30 when initialization or sustained capture fails.

- [ ] **Step 5: Implement gateway lifecycle**

Enroll only when given a one-time code, persist credentials mode 0600, authenticate over WSS, heartbeat every five seconds, reconnect with bounded backoff, and neutralize before and after every connection lifecycle.

- [ ] **Step 6: Make systemd the only product GPIO owner**

Run as `rc-pi-agent`, include `gpio` and `video` supplementary groups, use the protected environment and credential files, restart on failure, and conflict with the legacy control relay service.

- [ ] **Step 7: Run GREEN verification**

Run: `python -m pytest -q pi-agent`

Run: `python -m compileall -q pi-agent/rc_pi_agent`

- [ ] **Step 8: Commit**

```bash
git add pi-agent image
git commit -m "Connect Pi agent to RC Mania WebRTC gateway"
```

### Task 7: VPS, Nginx, and inactive TURN templates

**Files:**
- Create: `infra/compose/Dockerfile.gateway`
- Modify: `infra/compose/Dockerfile.web`
- Modify: `infra/compose/Dockerfile.node`
- Modify: `infra/compose/compose.vps-web.yaml`
- Create: `infra/compose/compose.turn.yaml`
- Create: `infra/compose/coturn/turnserver.conf.template`
- Modify: `infra/nginx/rcmania.conf`
- Create: `docs/runbooks/physical-car-enrollment.md`
- Create: `docs/runbooks/turn-enable.md`
- Modify: `apps/web/auth/vps-compose.test.ts`
- Create: `apps/gateway/src/infra.test.ts`

**Interfaces:**
- Produces: healthy `rcmania-gateway-1` at `127.0.0.1:3002`.
- Produces: Nginx `/gateway/` WebSocket proxy.
- Produces: inactive coturn template for 3478, 5349, and UDP 49160-49200.

- [ ] **Step 1: Write failing infrastructure tests**

Assert gateway health check, memory/CPU limits, private database network, secret requirements, WebSocket proxy headers/timeouts, disabled TURN profile, bounded relay range, and absence of static browser TURN passwords.

- [ ] **Step 2: Run RED verification**

Run: `pnpm.cmd --filter @rc/web exec vitest run auth/vps-compose.test.ts`

Run: `pnpm.cmd --filter @rc/gateway exec vitest run src/infra.test.ts`

- [ ] **Step 3: Implement production gateway deployment**

Add a commit-tagged gateway image, read-only runtime, tmpfs, health check, explicit resources, log rotation, localhost port, and PostgreSQL dependency without changing the database volume.

- [ ] **Step 4: Implement Nginx and TURN templates**

Proxy `/gateway/` with upgrade headers and long idle timeout. Keep coturn behind an explicit profile/override and document Namecheap and GCP rules without activating them.

- [ ] **Step 5: Run GREEN verification**

Run: `pnpm.cmd --filter @rc/web test && pnpm.cmd --filter @rc/gateway test`

Run after setting `POSTGRES_PASSWORD=test`, `DATABASE_URL=postgresql://rcmania:test@postgres:5432/rcmania`, `AUTH_SECRET=test-test-test-test-test-test`, `AUTH_URL=https://rcmania.live`, `GOOGLE_OAUTH_CLIENT_ID=test`, `GOOGLE_OAUTH_CLIENT_SECRET=test`, `DEVICE_AUTH_PEPPER=test-test-test-test-test-test`, `GATEWAY_SESSION_SECRET=test-test-test-test-test-test`, and `RC_IMAGE_TAG=test`: `docker compose -f infra/compose/compose.vps-web.yaml config --quiet`

- [ ] **Step 6: Commit**

```bash
git add infra docs/runbooks apps/web apps/gateway
git commit -m "Add production gateway and TURN templates"
```

### Task 8: Full verification, production deployment, and Pi enrollment

**Files:**
- No additional source files expected.

**Interfaces:**
- Consumes: committed RC main and committed Pi agent branch.
- Produces: healthy production web/gateway/database, enrolled Pi, and visible `RC Mania One`.

- [ ] **Step 1: Run fresh repository verification**

Run: `pnpm.cmd test && pnpm.cmd typecheck && pnpm.cmd build`

Run in the Pi repository: `python -m pytest -q pi-agent && python -m compileall -q pi-agent/rc_pi_agent`

- [ ] **Step 2: Publish the two repositories**

Inspect exact status and commits first. Push RC `main` and the current Pi branch only after confirming no unrelated files are staged.

- [ ] **Step 3: Back up PostgreSQL and deploy the VPS gateway/web release**

Create and verify a compressed `pg_dump`. Apply migration. Replace only RC Mania `web`, `gateway`, and `migrate` application containers/images. Preserve PostgreSQL and its volume. Install and validate the Nginx proxy. Verify HTTPS, OAuth, gateway health, logs, and disk.

- [ ] **Step 4: Provision `RC Mania One`**

Run the gateway provisioning CLI once and capture the enrollment code without logging it. Verify the site/car records start fail-closed before enrollment.

- [ ] **Step 5: Disable overlayroot and reboot the Pi**

Back up `/boot/firmware/cmdline.txt`, remove only the `overlayroot=tmpfs` token, reboot, reconnect using the pinned SSH host key, and verify `/` is the persistent ext4 filesystem.

- [ ] **Step 6: Install and enroll the Pi agent**

Install dependencies and the committed Pi package, write configuration and credentials with root-only permissions, enable the service, and verify camera/GPIO health while the traction battery remains disconnected.

- [ ] **Step 7: Verify presence and direct WebRTC**

Confirm five-second heartbeat, `RC Mania One | AVAILABLE`, real 720p mode, direct ICE candidate pair, live browser video, admin-only session, and neutral control output without traction power.

- [ ] **Step 8: Restore overlayroot and verify persistence**

Restore the exact `overlayroot=tmpfs` boot token, reboot, verify overlay mode, service auto-start, gateway reconnection, fresh heartbeat, and car availability.

- [ ] **Step 9: Record limitations and handoff**

Report actual fps, ICE mode, latency, remaining physical suspended-wheel test, TURN activation conditions, rollback references, database backup path, and disk usage.
