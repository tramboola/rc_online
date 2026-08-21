# Signed Raspberry Pi Agent OTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver administrator-triggered, signed, rollback-safe Python agent updates for RC Mania cars while preserving legacy control compatibility and `overlayroot` persistence.

**Architecture:** RC Mania stores immutable firmware metadata and per-device update jobs in PostgreSQL. Gateway offers a registered update only to an idle authenticated device; the Pi validates and stages a signed zip application, while a root-owned systemd updater performs an A/B switch on `/boot/firmware` and rolls back unless the new version confirms health within 90 seconds.

**Tech Stack:** Next.js 16, TypeScript 5.9, Fastify 5, PostgreSQL 16, Drizzle ORM, Zod 4, Python 3.11, aiohttp, cryptography/Ed25519, systemd, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-signed-pi-agent-ota-design.md`

## Global Constraints

- Preserve legacy agents that authenticate without OTA capabilities and accept only control protocol v3.
- Send control protocol v4 only to a device that explicitly advertises `controlProtocolVersion: 4`.
- Accept only administrator-selected, pre-registered versions; never accept an arbitrary URL or command from an API request.
- Never start an update during an active drive session.
- Neutralise PWM before download handoff, service restart, failure, or rollback.
- Limit artifacts to 8 MiB and require HTTPS, exact size, SHA-256, Ed25519 signature, and runtime generation `1`.
- Keep the signing private key outside Git and outside application containers.
- Store current and previous zip applications under `/boot/firmware/rc-pi-agent` so they survive `overlayroot` and reboot.
- Do not automatically retry a failed update.
- Use English commit messages.
- Preserve the existing user-owned untracked files in the RC worktree.

---

### Task 1: Create isolated implementation worktrees

**Files:**
- No source changes.

**Interfaces:**
- Consumes: RC `main` and Pi `codex/direct-reverse-v3`.
- Produces: isolated `codex/signed-pi-agent-ota` branches for both repositories.

- [ ] **Step 1: Verify the two base worktrees**

Run:

```powershell
git -c safe.directory='C:/Users/user/Documents/github/RC' status --short
git -C C:/Users/user/Documents/github/tether-rally-mjx status --short
```

Expected: only the three known user-owned untracked RC paths are present; the Pi repository is clean.

- [ ] **Step 2: Create worktrees with the worktree skill**

Create one RC worktree from `main` and one Pi worktree from `codex/direct-reverse-v3`, both on `codex/signed-pi-agent-ota`-prefixed branches. Record both base SHAs before changes.

- [ ] **Step 3: Run baseline tests**

Run:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
python -m pytest -q
python -m compileall -q rc_pi_agent
```

Expected: the RC suite and Pi suite pass before the first production edit.

---

### Task 2: Add firmware release and update-job persistence

**Files:**
- Create: `packages/database/migrations/0006_agent_ota.sql`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/migrations.test.ts`

**Interfaces:**
- Consumes: existing `firmware_versions`, `devices`, `users`, and `drive_sessions` tables.
- Produces: `firmwareVersions`, `deviceUpdateJobs`, `DeviceUpdateStatus`, and database constraints used by web and gateway stores.

- [ ] **Step 1: Write the failing migration test**

Add assertions that `0006_agent_ota.sql`:

```ts
expect(sql).toMatch(/alter table firmware_versions[\s\S]+artifact_url text/i);
expect(sql).toMatch(/create table device_update_jobs/i);
expect(sql).toMatch(/where status in \('pending', 'downloading', 'applying'\)/i);
expect(sql).toMatch(/attempt_count between 0 and 1/i);
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/database test
```

Expected: FAIL because migration `0006_agent_ota.sql` and schema exports do not exist.

- [ ] **Step 3: Add the backward-compatible SQL migration**

Add nullable artifact columns to the generic firmware table and require them for `component_kind = 'pi-agent'` with a check constraint. Create `device_update_jobs` with:

```sql
status text not null default 'pending',
attempt_count integer not null default 0,
failure_reason text,
requested_by uuid not null references users(id),
requested_at timestamptz not null default now(),
started_at timestamptz,
finished_at timestamptz,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

Add a partial unique index for one non-terminal job per device and checks for the status enum, 8 MiB size ceiling, lowercase SHA-256, runtime generation `1..32767`, bounded failure reason, and `attempt_count between 0 and 1`.

- [ ] **Step 4: Add Drizzle schemas**

Export exact tables with camel-case properties:

```ts
export const firmwareVersions = pgTable("firmware_versions", { /* existing plus artifact fields */ });
export const deviceUpdateJobs = pgTable("device_update_jobs", { /* matching migration */ });
export type DeviceUpdateStatus = "pending" | "downloading" | "applying" | "succeeded" | "failed";
```

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
pnpm.cmd --filter @rc/database test
pnpm.cmd --filter @rc/database typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/database
git commit -m "Add device OTA persistence"
```

---

### Task 3: Extend strict gateway contracts without breaking legacy devices

**Files:**
- Modify: `packages/contracts/src/device-gateway.ts`
- Modify: `packages/contracts/src/device-gateway.test.ts`

**Interfaces:**
- Consumes: existing strict v1 device and signaling messages.
- Produces: `DeviceCapabilitiesSchema`, `device.update.available`, and `device.update.status` messages.

- [ ] **Step 1: Write failing contract tests**

Cover all of these behaviours:

```ts
expect(GatewayClientMessageSchema.safeParse(legacyAuthenticate).success).toBe(true);
expect(GatewayClientMessageSchema.safeParse({ ...legacyAuthenticate, capabilities: {
  controlProtocolVersion: 4,
  otaRuntimeGeneration: 1
}}).success).toBe(true);
expect(GatewayServerMessageSchema.safeParse(validUpdateOffer).success).toBe(true);
expect(GatewayServerMessageSchema.safeParse({ ...validUpdateOffer, artifactUrl: "http://bad" }).success).toBe(false);
expect(GatewayClientMessageSchema.safeParse(validUpdateStatus).success).toBe(true);
```

Also reject extra keys, a non-UUID update ID, an uppercase/short digest, artifact sizes above `8 * 1024 * 1024`, unknown statuses, and failure reasons longer than 256 characters.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/contracts test
```

Expected: FAIL because OTA messages and capabilities are absent.

- [ ] **Step 3: Implement strict schemas**

Make `capabilities` optional on `device.authenticate` so the exact current `0.2.0` message remains valid. Define only:

```ts
const DeviceCapabilitiesSchema = z.object({
  controlProtocolVersion: z.literal(4).optional(),
  otaRuntimeGeneration: z.number().int().min(1).max(32767).optional()
}).strict();
```

Define the update offer and status exactly as specified in the design, using `z.string().url().refine(url => new URL(url).protocol === "https:")` and bounded base64url signature text.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
pnpm.cmd --filter @rc/contracts test
pnpm.cmd --filter @rc/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts
git commit -m "Define signed device update messages"
```

---

### Task 4: Persist authenticated device capabilities and OTA state transitions

**Files:**
- Modify: `apps/gateway/src/store.ts`
- Modify: `apps/gateway/src/postgres-store.ts`
- Modify: `apps/gateway/src/server.ts`
- Modify: `apps/gateway/src/server.test.ts`
- Create: `apps/gateway/src/update-store.test.ts`

**Interfaces:**
- Consumes: Task 2 tables and Task 3 schemas.
- Produces:

```ts
authenticateDevice(deviceId: string, hash: string, agentVersion: string, capabilities: DeviceCapabilities, now: Date): Promise<AuthenticatedDevice | null>;
claimPendingUpdate(deviceId: string, runtimeGeneration: number | null, now: Date): Promise<DeviceUpdateOffer | null>;
recordUpdateStatus(deviceId: string, updateId: string, status: UpdateProgressStatus, reason: string | null, now: Date): Promise<boolean>;
```

- [ ] **Step 1: Write failing store/server tests**

Assert that authentication updates `devices.agent_version` and merges only bounded public capabilities into `metadata.capabilities`. Assert that:

- legacy authentication still succeeds;
- a pending compatible job is returned once and moves to `downloading` with `attempt_count = 1`;
- an incompatible runtime is not claimed;
- reconnecting with the target version marks `applying` work `succeeded`;
- reconnecting with the previous version after `applying` marks the job `failed`;
- a terminal job cannot transition again.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/gateway test
```

Expected: FAIL because the new store methods and server handling do not exist.

- [ ] **Step 3: Implement transactional state changes**

Use row locks for claims and terminal transitions. Select only `pi-agent` firmware records with complete artifact metadata. Never construct an offer from client input. Store failure reasons after trimming and limiting to 256 characters.

Update websocket authentication to pass `agentVersion` and optional capabilities to the store. Handle `device.update.status` only for the authenticated device and close with protocol error on forged ownership.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
pnpm.cmd --filter @rc/gateway test
pnpm.cmd --filter @rc/gateway typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/gateway
git commit -m "Track device OTA state in gateway"
```

---

### Task 5: Offer updates only to idle cars

**Files:**
- Modify: `apps/gateway/src/sessions.ts`
- Modify: `apps/gateway/src/sessions.test.ts`
- Modify: `apps/gateway/src/server.ts`
- Modify: `apps/gateway/src/server.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry`, `claimPendingUpdate`, authenticated device capabilities.
- Produces: `SessionRegistry.hasActiveCar(carId: string): boolean` and idle-only update dispatch after authentication/heartbeat.

- [ ] **Step 1: Write failing tests**

Add a registry test:

```ts
expect(registry.hasActiveCar(carId)).toBe(false);
expect(registry.attachBrowser(session, browser)).toBe(true);
expect(registry.hasActiveCar(carId)).toBe(true);
```

Add server tests proving no claim occurs while a drive is active, one offer is sent to an idle capable device, and a legacy device receives no OTA message.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/gateway test
```

Expected: FAIL on missing `hasActiveCar` and dispatch.

- [ ] **Step 3: Implement idle dispatch**

After accepted authentication and after each healthy heartbeat, call a small `offerPendingUpdate()` function only when:

```ts
authenticated.capabilities.otaRuntimeGeneration !== undefined &&
!sessions.hasActiveCar(authenticated.carId)
```

Rely on the transactional claim for duplicate suppression.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm.cmd --filter @rc/gateway test
git add apps/gateway
git commit -m "Offer updates only to idle cars"
```

---

### Task 6: Add administrator update endpoints

**Files:**
- Create: `apps/web/app/device-update-store.ts`
- Create: `apps/web/app/device-update-store.test.ts`
- Create: `apps/web/app/api/admin/device-updates/route.ts`
- Create: `apps/web/app/api/admin/device-updates/route.test.ts`

**Interfaces:**
- Consumes: Task 2 tables and existing NextAuth administrator pattern.
- Produces:

```ts
requestDeviceUpdate(adminId: string, carId: string, version: string, now: Date): Promise<{ updateId: string } | null>;
getLatestDeviceUpdate(carId: string): Promise<DeviceUpdateSummary | null>;
```

- [ ] **Step 1: Write failing store and route tests**

Cover signed-out `401`, regular user `403`, cross-origin `403`, malformed `400`, unknown version/car `404`, active session or existing update `409`, and successful `201`. Verify the store resolves the device from the car, requires a registered `pi-agent` version with complete metadata, and rejects any active non-expired drive session.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/web test -- app/api/admin/device-updates/route.test.ts app/device-update-store.test.ts
```

Expected: FAIL because the route and store are absent.

- [ ] **Step 3: Implement minimal API and store**

The POST body schema is exactly:

```ts
z.object({ carId: z.string().uuid(), version: z.string().regex(/^\d+\.\d+\.\d+$/u) }).strict()
```

Use the same trusted forwarded-origin check as the existing drive-session route. GET accepts only a UUID `carId` query parameter and returns no signing secrets.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm.cmd --filter @rc/web test -- app/api/admin/device-updates/route.test.ts app/device-update-store.test.ts
pnpm.cmd --filter @rc/web typecheck
git add apps/web
git commit -m "Add administrator device update API"
```

---

### Task 7: Negotiate control protocol v3 or v4 per connected device

**Files:**
- Modify: `apps/web/app/drive-session-store.ts`
- Modify: `apps/web/app/drive-session-store.test.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.test.ts`
- Modify: `apps/web/app/ride-session-client.ts`
- Modify: `apps/web/app/ride-session-client.test.ts`
- Modify: `apps/web/app/control-loop.ts`
- Modify: `apps/web/app/control-loop.test.ts`
- Modify: `apps/web/app/real-ride-screen.tsx`

**Interfaces:**
- Consumes: stored `devices.metadata.capabilities.controlProtocolVersion`.
- Produces: `controlProtocolVersion: 3 | 4` in `CreatedDriveSession` and `StoredDriveSession`, and `buildControlFrame(..., protocolVersion)`.

- [ ] **Step 1: Write failing compatibility tests**

Prove that missing, malformed, or non-4 capability data yields v3; exact numeric `4` yields v4. Prove v3 frames contain the original exact field set and omit `steeringTrimPercent`; v4 frames include the bounded trim.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/web test -- app/drive-session-store.test.ts app/control-loop.test.ts app/ride-session-client.test.ts
```

Expected: FAIL because sessions always emit v4.

- [ ] **Step 3: Implement negotiation**

Select `devices.metadata` in the locked availability query. Parse capabilities defensively without trusting arbitrary JSON. Return and persist only `3` or `4`. Keep steering trim stored and displayed for both versions, but transmit it only through v4.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm.cmd --filter @rc/web test
pnpm.cmd --filter @rc/web typecheck
git add apps/web
git commit -m "Negotiate legacy and trim control frames"
```

---

### Task 8: Build and register deterministic signed agent artifacts

**Files (Pi repository):**
- Create: `pi-agent/rc_pi_agent/version.py`
- Create: `pi-agent/rc_pi_agent/__main__.py`
- Create: `image/scripts/build-ota-artifact.py`
- Create: `pi-agent/tests/test_ota_artifact.py`
- Modify: `pi-agent/rc_pi_agent/main.py`

**Files (RC repository):**
- Create: `apps/gateway/src/register-agent-release.ts`
- Create: `apps/gateway/src/register-agent-release.test.ts`
- Modify: `apps/gateway/package.json`

**Interfaces:**
- Consumes: a source tree, semantic version, runtime generation, and Ed25519 private-key path.
- Produces: `rc-pi-agent-<version>.pyz`, `rc-pi-agent-<version>.json`, and an immutable `firmware_versions` record.

- [ ] **Step 1: Write failing artifact tests**

Build the same source twice with fixed inputs and assert byte-for-byte equality. Open the zip and require `__main__.py`, `rc_pi_agent/main.py`, and generated `rc_pi_agent/_build_version.py`. Verify the manifest digest and Ed25519 signature with a test key; reject a mutated byte.

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest -q pi-agent/tests/test_ota_artifact.py
```

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement the deterministic builder**

Use sorted relative paths, fixed ZIP timestamps `(1980, 1, 1, 0, 0, 0)`, deflate compression, no absolute paths, no symlinks, and generated version code:

```py
AGENT_VERSION = "0.4.0"
OTA_RUNTIME_GENERATION = 1
```

Sign the complete `.pyz` bytes with `Ed25519PrivateKey.sign()` and encode the signature with URL-safe base64 without padding.

- [ ] **Step 4: Write RED tests for release registration**

Test strict manifest parsing, fixed `https://rcmania.live/agent-releases/` prefix, lowercase digest, exact component/version uniqueness, size ceiling, and refusal to replace existing version metadata.

- [ ] **Step 5: Implement the gateway CLI**

Add package script:

```json
"register-agent-release": "tsx src/register-agent-release.ts"
```

The CLI reads one manifest path, validates it, and inserts only metadata. It never reads the signing private key.

- [ ] **Step 6: Verify GREEN and commit in each repository**

```powershell
python -m pytest -q pi-agent/tests/test_ota_artifact.py
pnpm.cmd --filter @rc/gateway test
git commit -m "Build signed Pi agent artifacts"
git commit -m "Register immutable Pi agent releases"
```

---

### Task 9: Download and validate an offered update in the unprivileged agent

**Files (Pi repository):**
- Create: `pi-agent/rc_pi_agent/ota.py`
- Create: `pi-agent/tests/test_ota.py`
- Modify: `pi-agent/rc_pi_agent/gateway.py`
- Modify: `pi-agent/rc_pi_agent/main.py`
- Modify: `pi-agent/tests/test_gateway.py`
- Modify: `pi-agent/tests/test_agent.py`

**Interfaces:**
- Consumes: strict `device.update.available` message and public key path.
- Produces:

```py
@dataclass(frozen=True, slots=True)
class UpdateOffer: ...

class OtaUpdateManager:
    async def handle(self, offer: Mapping[str, object], *, drive_active: bool) -> UpdateDecision: ...
    def confirm_healthy(self, version: str) -> None: ...
```

- [ ] **Step 1: Write failing validation tests**

Use a local aiohttp test server and a generated test Ed25519 key. Cover successful staging plus rejection of HTTP, wrong host, redirect to another host, oversized `Content-Length`, streamed bytes over 8 MiB, size mismatch, digest mismatch, signature mismatch, zip traversal/symlink entries, runtime mismatch, active drive, and concurrent update.

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest -q pi-agent/tests/test_ota.py
```

Expected: FAIL because `OtaUpdateManager` is absent.

- [ ] **Step 3: Implement minimal staged handoff**

Download with total timeout 30 seconds, no cross-host redirects, and bounded streaming. Write artifact and JSON request through `*.tmp` files with mode `0600`, `fsync`, and `os.replace`. Verify with `cryptography.hazmat.primitives.asymmetric.ed25519.Ed25519PublicKey`.

The main agent checks `active_peer is None`, calls `runtime.neutral("ota-update")`, sends bounded status, and passes the offer to the manager. It does not run a shell command or call sudo.

- [ ] **Step 4: Advertise capabilities and health confirmation**

Send capabilities during authentication:

```py
{"controlProtocolVersion": 4, "otaRuntimeGeneration": 1}
```

After authentication and the first successful heartbeat, atomically write the exact current version to `/var/lib/rc-pi-agent/healthy-version`.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
python -m pytest -q pi-agent/tests/test_ota.py pi-agent/tests/test_gateway.py pi-agent/tests/test_agent.py
git add pi-agent
git commit -m "Stage verified OTA updates on Pi"
```

---

### Task 10: Add root-owned A/B updater and systemd bootstrap

**Files (Pi repository):**
- Create: `image/scripts/rc-pi-agent-ota-updater`
- Create: `image/rc-pi-agent-update.path`
- Create: `image/rc-pi-agent-update.service`
- Modify: `image/rc-pi-agent.service`
- Modify: `image/rc-pi-agent.env.example`
- Modify: `image/scripts/install-pi-agent.sh`
- Modify: `pi-agent/tests/test_install_artifacts.py`
- Create: `pi-agent/tests/test_ota_updater.py`
- Modify: `SETUP.md`

**Interfaces:**
- Consumes: verified request files under `/var/lib/rc-pi-agent`.
- Produces: persistent `current.pyz`/`previous.pyz` slots, a restarted service, result file, and automatic rollback.

- [ ] **Step 1: Write failing install-artifact tests**

Assert the service executes `current.pyz`, the path unit watches `update-ready`, the update service runs as root with `Type=oneshot`, and the updater/public key are root-owned installation artifacts. Assert the updater never evaluates request content as a shell command.

- [ ] **Step 2: Write failing updater behaviour tests**

Using temporary boot/state roots and injected callbacks, test:

- valid current becomes previous and staged becomes current;
- exact healthy confirmation keeps current;
- missing/wrong confirmation after 90-second injected deadline restores previous;
- invalid signature/digest/path leaves current untouched;
- an interrupted temp copy leaves the old current readable;
- every switch/revert requests neutral stop before restart.

- [ ] **Step 3: Verify RED**

Run:

```powershell
python -m pytest -q pi-agent/tests/test_install_artifacts.py pi-agent/tests/test_ota_updater.py
```

Expected: FAIL because the updater artifacts are absent.

- [ ] **Step 4: Implement the updater**

Implement the updater as a root-owned Python executable using no network. Re-parse the strict request, re-verify size/digest/signature/runtime, copy through a same-filesystem temporary file, flush, atomically replace, restart through an injected/system `systemctl`, and poll the health marker for at most 90 seconds. Restore previous and restart on failure.

Use `ConditionPathExists=/var/lib/rc-pi-agent/update-ready`, tight systemd hardening, and no writable path beyond the state and boot OTA directories.

- [ ] **Step 5: Update the installer idempotently**

The installer creates the boot directory, builds/installs an initial signed or explicitly bootstrap-trusted `current.pyz`, preserves an existing current slot, installs the public key, units, and updater, then enables the path and agent services. It must not overwrite `/etc/rc-pi-agent/agent.env` or device credentials on upgrade.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
python -m pytest -q pi-agent/tests/test_install_artifacts.py pi-agent/tests/test_ota_updater.py
python -m compileall -q pi-agent/rc_pi_agent
git add image pi-agent/tests SETUP.md
git commit -m "Install rollback-safe Pi OTA bootstrap"
```

---

### Task 11: Serve immutable agent releases from the VPS

**Files (RC repository):**
- Modify: `infra/nginx/rcmania.conf`
- Modify: `apps/gateway/src/infra.test.ts`
- Create: `docs/runbooks/pi-agent-ota.md`
- Modify: `docs/deployment-vps.md`

**Interfaces:**
- Consumes: signed artifact and manifest produced by Task 8.
- Produces: immutable HTTPS artifact URL and documented key generation, registration, rollout, verification, and rollback commands.

- [ ] **Step 1: Write failing infrastructure test**

Require a dedicated exact prefix and safe static behaviour:

```ts
expect(nginx).toContain("location /agent-releases/");
expect(nginx).toContain("alias /opt/rcmania/shared/agent-releases/");
expect(nginx).toContain("add_header Cache-Control \"public, max-age=31536000, immutable\"");
expect(nginx).toContain("autoindex off");
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/gateway test -- src/infra.test.ts
```

Expected: FAIL because Nginx has no release location.

- [ ] **Step 3: Add static location and runbook**

Allow only `GET`/`HEAD`, disable autoindex, serve fixed files from the shared directory, set immutable cache headers, preserve the existing app/gateway locations, and document:

- generating root-only Ed25519 keys;
- installing only the public key on Pi;
- building and uploading artifacts;
- registration command;
- administrator update request;
- success/rollback inspection;
- keeping traction power disconnected or wheels raised for first rollout.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm.cmd --filter @rc/gateway test
git add infra/nginx docs/runbooks docs/deployment-vps.md apps/gateway/src/infra.test.ts
git commit -m "Serve immutable Pi agent releases"
```

---

### Task 12: Full local verification and security review

**Files:**
- Modify only defects directly found by these checks, each through a new failing regression test.

**Interfaces:**
- Consumes: Tasks 2–11.
- Produces: release-candidate commits in both repositories.

- [ ] **Step 1: Run all RC checks**

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd --filter @rc/web build
git diff --check
```

Expected: all commands exit zero with no new warnings.

- [ ] **Step 2: Run all Pi checks**

```powershell
python -m pytest -q
python -m compileall -q rc_pi_agent
git diff --check
```

Expected: all tests pass.

- [ ] **Step 3: Run focused adversarial checks**

Prove with tests that a forged URL, signature, digest, version, update owner, update state, and active-drive request all fail closed and leave PWM neutral. Confirm no private key, generated artifact, credential, or temporary QA file is tracked by Git.

- [ ] **Step 4: Review React changes**

Confirm protocol version is primitive state, no unnecessary effect or render subscription was introduced, and global listeners/control loop remain stable.

- [ ] **Step 5: Record release SHAs**

Store both exact commit SHAs in the deployment notes; do not use `latest` or an unpinned branch during deployment.

---

### Task 13: Staged production rollout and real-car proof

**Files:**
- No new source files unless verification exposes a regression, which must begin with a failing test.

**Interfaces:**
- Consumes: user approval to publish, exact RC/Pi SHAs, signing secret, and SSH bootstrap access.
- Produces: compatible VPS, OTA-capable Pi, and one successful signed OTA update.

- [ ] **Step 1: Merge and push exact reviewed branches**

Fast-forward RC into `main` and Pi into `codex/direct-reverse-v3`, preserving unrelated local files. Push both and record the remote SHAs.

- [ ] **Step 2: Back up and deploy compatibility first**

Create a PostgreSQL backup, deploy migration/web/gateway, verify healthy containers, HTTPS, gateway readiness, and that the connected legacy `0.2.0` car receives protocol v3 and can still neutral/steer with traction power safely isolated.

- [ ] **Step 3: Bootstrap OTA once over SSH**

Verify Raspberry Pi model, disk, mounts, `overlayroot`, time, camera, GPIO, and service state. Stop the agent into neutral, install the OTA public key/updater/units and baseline `0.4.0` artifact, start services, and confirm `AVAILABLE`, capability advertisement, camera, and v4 control.

- [ ] **Step 4: Publish a signed `0.4.1` proof artifact**

Build with the root-only private key, upload `.pyz`/manifest to `/opt/rcmania/shared/agent-releases`, verify the public HTTPS bytes match the manifest, and register version `0.4.1` through the CLI.

- [ ] **Step 5: Trigger and observe OTA**

Create one administrator update job for RC Mania One. Verify status sequence `pending → downloading → applying → succeeded`, reconnect agent version `0.4.1`, exact healthy marker, service active state, and no rollback.

- [ ] **Step 6: Test rollback deliberately with a signed failing fixture**

Use a signed test artifact that exits before health confirmation, only while traction power is disconnected or wheels are raised. Verify automatic return to `0.4.1`, job failure without retry, `AVAILABLE` recovery, and neutral PWM throughout.

- [ ] **Step 7: Final smoke test and space check**

Run one short live session, verify video, v4 steering trim, timer expiry, end-session neutral, web/gateway/Pi logs, and disk usage on both VPS and Pi. Keep the prior VPS image and `previous.pyz` as the documented rollback points.

