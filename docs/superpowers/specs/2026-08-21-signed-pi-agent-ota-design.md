# Signed Raspberry Pi Agent OTA Design

## Objective

Add administrator-triggered over-the-air updates for RC Mania Raspberry Pi car agents without opening inbound management ports for normal operation. Updates must never run during a drive, must put GPIO outputs in neutral before installation, must survive `overlayroot`, and must automatically return to the previous agent when the new version does not become healthy.

This release also removes the opaque dark backgrounds around the live connection status and steering-neutral adjustment so those controls do not obstruct the camera view.

## Scope

The first OTA version updates the pure-Python `rc_pi_agent` application only. It does not update Raspberry Pi OS, kernel packages, camera drivers, system Python dependencies, or the immutable OTA bootstrap itself. Changes to those components remain a maintenance operation performed over SSH with traction power disconnected.

OTA is explicitly triggered by an authenticated RC Mania administrator. There is no automatic rollout from `main`, no unattended "latest" channel, and no fleet-wide button in this version.

## Selected Architecture

The agent is packaged as an immutable Python zip application (`.pyz`). Each artifact has:

- an explicit semantic version;
- a byte-size limit of 8 MiB;
- a SHA-256 digest;
- an Ed25519 signature over the exact artifact bytes;
- a required runtime generation, initially `1`.

Artifacts are stored outside release directories under `/opt/rcmania/shared/agent-releases` on the application VPS. Nginx exposes them at immutable URLs below `https://rcmania.live/agent-releases/`. The source repository is public, so confidentiality is not a security boundary; authenticity is enforced by the signature embedded in the OTA manifest and verified against the public key installed on each Pi.

The Ed25519 private key is generated once and remains a root-readable VPS secret. It is never committed, mounted into the web or gateway container, or copied to a car. The public key is committed as an installation artifact and copied to `/etc/rc-pi-agent/ota-public.pem` during the one-time SSH bootstrap.

## Persistent Layout on Raspberry Pi

`overlayroot` makes ordinary root-filesystem writes unsuitable for OTA. The update slots therefore live on the separately mounted boot filesystem:

```text
/boot/firmware/rc-pi-agent/
  current.pyz
  current.json
  previous.pyz
  previous.json
```

Temporary downloads, update requests, status files, and health confirmations live under `/var/lib/rc-pi-agent`. They only need to survive the service restart that performs an update. The current and previous boot slots survive a reboot.

The initial SSH installation changes `rc-pi-agent.service` to start:

```text
/opt/rc-pi-agent/venv/bin/python /boot/firmware/rc-pi-agent/current.pyz
```

The existing virtual environment continues to provide pinned binary dependencies such as `aiortc`, `cryptography`, `lgpio`, and `picamera2`. An artifact with a different runtime generation is rejected and requires an SSH maintenance update.

## Server Data Model

The existing `firmware_versions` table is represented in the TypeScript schema and extended with:

- `artifact_url`;
- `artifact_size_bytes`;
- `runtime_generation`;
- `published_at`.

A new `device_update_jobs` table records one update attempt:

- update ID, device ID, and firmware version ID;
- `pending`, `downloading`, `applying`, `succeeded`, or `failed` status;
- bounded failure reason;
- requested administrator and timestamps;
- attempt count, limited to one automatic attempt.

Only one non-terminal update may exist per device. Update records are retained for audit and troubleshooting.

## Administrator Trigger

`POST /api/admin/device-updates` accepts `{ carId, version }`. It requires an authenticated administrator, validates the exact registered version, rejects a car with an active drive session, and creates a pending update job. It never accepts an arbitrary URL, digest, signature, shell command, or `latest` alias from the request.

`GET /api/admin/device-updates?carId=<uuid>` returns the latest bounded status for operational inspection. A dedicated management page is outside this release; the endpoint is sufficient for the first car and can later back an admin UI.

## Gateway Protocol

Device authentication remains backwards compatible. New agents add bounded capabilities:

```json
{
  "controlProtocolVersion": 4,
  "otaRuntimeGeneration": 1
}
```

Absence of these capabilities identifies the current legacy agent. Drive-session creation returns control protocol v3 for a legacy device and v4 only when the device explicitly advertises v4. This prevents the newly deployed browser from neutralising an old Pi with an unsupported frame.

When a device has no active drive and a pending compatible job, gateway sends:

```json
{
  "v": 1,
  "type": "device.update.available",
  "updateId": "uuid",
  "version": "0.4.0",
  "runtimeGeneration": 1,
  "artifactUrl": "https://rcmania.live/agent-releases/rc-pi-agent-0.4.0.pyz",
  "artifactSizeBytes": 123456,
  "digestSha256": "64 lowercase hex characters",
  "signature": "base64url Ed25519 signature"
}
```

The Pi sends `device.update.status` messages for `downloading`, `applying`, and validation failures. After a service restart, gateway compares the authenticated agent version with the job target. A matching version marks the job succeeded; reconnecting on the previous version after an applying state marks it failed and prevents an update loop.

All new protocol objects use strict schemas, bounded strings and sizes, UUID update IDs, HTTPS-only artifact URLs, and explicit enums.

## Pi Update Lifecycle

1. Gateway offers an update only while the car has no active drive session.
2. The agent rejects an offer when a peer is active, the runtime generation differs, or an update is already running.
3. The agent neutralises steering and throttle and stops accepting drive sessions.
4. It downloads into a new file with an 8 MiB hard limit and a short network timeout.
5. It verifies exact size, SHA-256, Ed25519 signature, and zip application structure.
6. It writes an owner-only request file and an atomic ready marker.
7. A root-owned systemd path unit starts the OTA updater. The unprivileged agent never executes a supplied command and never gains general sudo access.
8. The updater independently repeats size, digest, signature, version, and path validation.
9. It copies `current` to `previous`, atomically replaces `current`, clears the old health confirmation, and restarts `rc-pi-agent.service`.
10. The new agent writes its version confirmation only after gateway authentication and a successful healthy heartbeat.
11. The updater waits up to 90 seconds. Without the exact confirmation it restores `previous`, restarts the service, and records a failed result.

Every error path neutralises PWM. Update failures do not alter device credentials, car steering trim, or application data.

## Build and Release Flow

A repository script builds a deterministic zip application from `pi-agent/rc_pi_agent`, verifies that it imports with the existing runtime, calculates SHA-256, and signs it using a private-key path supplied outside the repository. It emits the `.pyz` plus a JSON manifest.

A release registration command validates the manifest again, copies the artifact into the shared VPS directory with root ownership, and inserts the immutable firmware record. Re-registering the same component/version with different bytes is rejected.

Rollback is operationally simple: an administrator targets the previously registered version, or the Pi performs the automatic local rollback before it reports failure.

## Live Ride UI

The connection status remains in the upper-right corner but loses the `data-panel` frame, opaque background, border, and drop shadow. Text and icons use a small shadow for contrast over bright video.

The steering-neutral control remains centred at the bottom and keeps the full-width range input, value, save state, and reset action. Its surrounding border, opaque background, and large drop shadow are removed. Only the actual controls and labels remain visible over the camera.

The timer, keyboard visualisation, and end-session button are unchanged.

## Verification

Automated coverage must include:

- strict gateway message schemas and legacy compatibility;
- v3 selection for the current `0.2.0` device and v4 selection for a capable agent;
- admin authorization and active-session rejection;
- update job claiming and terminal-state transitions;
- artifact size, URL, digest, signature, and runtime validation;
- successful A/B switch, missing confirmation rollback, and corrupted artifact rollback;
- preservation of neutral GPIO behaviour throughout update handling;
- all current web, gateway, database, and Pi tests;
- production web build and Python compilation.

Rendered QA covers the live ride screen at 1920×1080 and a smaller desktop viewport. It verifies that both opaque panels are absent, controls remain readable, the camera is less obstructed, and no framework or console errors appear.

The real rollout is staged in this order:

1. deploy backwards-compatible gateway and web changes;
2. verify the old Pi still drives with protocol v3;
3. bootstrap OTA once over SSH with traction power disconnected or driven wheels raised;
4. register and target the first signed artifact;
5. verify the Pi reconnects with the new version and the update job succeeds;
6. run a short steering-neutral test before reconnecting traction power normally.

## Failure Boundaries

- OTA cannot bootstrap itself; one successful SSH installation is required.
- A closed SSH port does not affect future OTA after bootstrap.
- Dependency, kernel, camera-driver, and operating-system updates remain SSH maintenance.
- The system never retries a failed version automatically. An administrator must inspect the failure and explicitly request another attempt.
