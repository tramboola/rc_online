# UPS Battery Telemetry Design

**Date:** 2026-08-25
**Status:** Approved for implementation
**Scope:** RC Mania cloud/web repository and `tether-rally-mjx` Raspberry Pi agent repository

## Goal

Read the Waveshare UPS HAT (B) battery voltage on RC Mania One, estimate its charge percentage, persist the latest measurement with the car, and show honest live battery information in the queue and during a real drive. The feature must keep `overlayroot` enabled in normal operation and must not make a sensor failure disable an otherwise safe car.

## Confirmed Hardware

- Raspberry Pi 4 Model B Rev 1.5.
- Waveshare UPS HAT (B) with INA219 at I2C address `0x42` on `/dev/i2c-1`.
- A direct read on 2026-08-25 returned ten stable samples between `8.272 V` and `8.284 V`.
- `dtparam=i2c_arm=on` is now persisted in `/boot/firmware/config.txt`.
- The UPS measurement describes the two-cell UPS pack that powers the Raspberry Pi. It does not describe a separate ESC traction battery.

## Product Behaviour

1. Queue car cards show the latest persisted UPS percentage, or an em dash when no valid measurement is available.
2. The real-drive status panel shows the live percentage received through the authenticated Gateway WebSocket.
3. A value below 20 percent uses the existing warning/red visual language. At or above 20 percent it uses the normal lime status treatment.
4. Battery telemetry is informational in this iteration. It does not block availability, reject a drive session, limit throttle, or stop an active car.
5. A missing sensor, read error, or stale sample displays an em dash. It must not retain a misleading old percentage indefinitely.
6. Mock mode keeps deterministic fixture values and never claims that they came from hardware.

## Data Flow

```text
INA219 register 0x02
        |
        v
Pi BatteryMonitor -> five-sample median -> DeviceHealth heartbeat every 5 s
        |
        v
Gateway validation -> devices.health JSON + cars.battery_percent
        |                                      |
        |                                      +-> queue/server-rendered fleet data
        v
active browser session -> device.telemetry -> RideSessionClient -> real-drive UI
```

## Raspberry Pi Agent

### Battery monitor

Create a focused `rc_pi_agent/battery.py` module. It uses only the Python standard library (`os` and `fcntl`) to access Linux `i2c-dev`; no runtime `pip` or apt dependency is added.

The monitor:

- defaults to bus `1`, address `0x42`, and bus-voltage register `0x02`;
- accepts overrides through `RC_BATTERY_I2C_BUS` and `RC_BATTERY_I2C_ADDRESS`;
- samples once per second in a background asyncio task;
- keeps the five most recent successful voltage readings and reports their median;
- converts voltage to percentage with piecewise linear interpolation across this 2S table:
  `6.60/0`, `6.80/5`, `7.00/10`, `7.20/20`, `7.40/35`, `7.60/50`, `7.80/65`, `8.00/80`, `8.20/90`, `8.40/100`;
- rounds voltage to three decimal places and percentage to an integer in `0..100`;
- clears the published snapshot after three consecutive read failures;
- never raises a sensor exception into the drive-control or Gateway loops.

The Pi heartbeat includes `batteryVoltage` and `batteryPercent`. Both are nullable. A working monitor sends numbers; an unavailable monitor sends `null` after the failure threshold.

### Persistent I2C with overlayroot

The immutable Pi installer is extended so a newly installed base system:

- enables `dtparam=i2c_arm=on` idempotently;
- installs an `i2c-dev` modules-load entry;
- adds `rc-pi-agent` to the existing `i2c` group;
- declares `i2c` in the agent service `SupplementaryGroups`.

RC Mania One currently uses a tmpfs `overlayroot`, so OTA can replace `current.pyz` but cannot persist `/etc` changes. The one-time production rollout therefore updates the underlying base system during a maintenance cycle, then boots back with `overlayroot=tmpfs`. Normal operation and all subsequent OTA updates keep overlayroot enabled.

The OTA artifact contains the battery module and agent integration. It must remain functional if the base-system I2C preparation has not yet happened: telemetry is null and driving continues.

## Cloud Contract

Extend `DeviceHealthSchema` with two optional nullable fields:

```ts
batteryVoltage: z.number().min(0).max(16).nullable().optional()
batteryPercent: z.number().int().min(0).max(100).nullable().optional()
```

Optional fields preserve forward/backward compatibility:

- the updated Gateway accepts old agents that omit both fields;
- the updated agent is deployed only after the Gateway accepts both fields;
- `undefined` means an old agent and preserves the stored car value;
- `null` means the new agent cannot currently measure the battery and clears the stored car value;
- a number replaces the stored value.

Add a server-to-browser message scoped to the active drive session:

```ts
{
  v: 1,
  type: "device.telemetry",
  sessionId: string,
  batteryVoltage: number | null,
  batteryPercent: number | null
}
```

The Gateway constructs this message from a validated device heartbeat. A device cannot choose another session identifier, and telemetry is sent only to the browser currently paired with that car.

## Gateway and Persistence

`PostgresGatewayStore.recordHeartbeat` continues updating `devices.health` and `lastSeenAt`. When the authenticated device is attached to a car, it also applies the compatibility rules above to `cars.battery_percent`.

The presence state remains based only on camera, GPIO, watchdog, and administrative block status. Battery values do not participate in `AVAILABLE`, `SAFETY_BLOCKED`, or session authorization.

`SessionRegistry` gains a narrowly scoped method that accepts a car ID and validated battery values, looks up the active session for that car, and sends `device.telemetry` to that session's browser. It returns false when no browser session exists; that is normal and not an error.

## Web Interface

### Queue

The queue already reads `cars.battery_percent`. No new endpoint is needed. Tests must prove that a number renders as a percentage and `null` renders as an em dash.

### Real drive

`RideSessionClient` exposes an `onTelemetry` callback. It validates the session ID and supplies nullable battery voltage and percentage to `RealRideScreen`.

`RealRideScreen` initializes battery state as unavailable and renders a compact battery row in the existing `real-ride-status` group. It shows only percentage to the driver; voltage remains available to diagnostics and tests. The row updates without reconnecting WebRTC and is removed with the ride screen when the session ends.

## Error Handling and Safety

- Opening the I2C device, selecting address `0x42`, or reading register `0x02` may fail. Failures are contained inside `BatteryMonitor`.
- One or two failed samples retain the last filtered snapshot to avoid flicker. Three consecutive failures publish null telemetry.
- Invalid or out-of-range telemetry is rejected by the Gateway schema.
- A malformed device message still follows the existing close-on-invalid-message policy.
- Battery telemetry never delays or shares state with the 50 Hz drive-control loop.
- No battery value is used as a substitute for the HAT's electrical protection or for traction-battery monitoring.

## Testing

### Pi repository

- voltage-register decoding with deterministic two-byte samples;
- table boundaries and interpolation;
- five-sample median filtering;
- three-failure invalidation and recovery;
- heartbeat contains numeric or null telemetry without changing existing health fields;
- installer and systemd artifacts include I2C persistence and group access.

### RC Mania repository

- contract accepts old, numeric, and null heartbeats and rejects invalid ranges;
- store preserves on omitted fields, clears on null, and updates on numeric percentage;
- SessionRegistry routes telemetry only to the active browser for the authenticated car;
- RideSessionClient validates and emits telemetry;
- real-drive and queue rendering cover numeric, warning, and unavailable states;
- existing heartbeat, availability, WebRTC, queue, and mobile ride tests remain green.

## Rollout and Rollback

1. Deploy contracts, Gateway, and web first. Verify an old Pi heartbeat remains accepted and RC Mania One stays available.
2. Update the persistent Pi base configuration for `i2c-dev` and `i2c` group access, returning the machine to `overlayroot=tmpfs` before acceptance testing.
3. Publish and assign the signed Pi OTA artifact.
4. Verify `0x42`, filtered voltage, heartbeat health, database percentage, queue card, active-drive telemetry, camera, GPIO, watchdog, and neutral output.
5. Roll back the Pi agent through the existing previous OTA slot if its health confirmation fails. Battery fields disappear but the compatible Gateway continues operating.
6. Roll back web/Gateway to the preceding images if cloud validation fails. Do not deploy the new Pi artifact against an old strict Gateway schema.

## Acceptance Criteria

- After a cold Pi reboot with overlayroot enabled, `/dev/i2c-1` exists and `rc-pi-agent` can read INA219 without sudo.
- Pi Agent remains active and RC Mania One remains available when the sensor works or fails.
- A real measurement reaches `cars.battery_percent` within two heartbeats.
- Queue and real-drive interfaces show the same latest percentage, with no hard-coded production battery value.
- Disconnecting or making INA219 unreadable changes the UI to unavailable after three failed samples without stopping a drive.
- Camera, WebRTC, GPIO control, watchdog, OTA rollback, and boot read-only protections continue to work.
