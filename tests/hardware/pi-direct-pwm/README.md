# Raspberry Pi direct PWM bench tests

This tool is only for a short proof that a Raspberry Pi 4 can control a
standard RC steering servo and a separate ESC through their signal inputs.
It is not the production safety controller. Production rides still require
the ESP32 watchdog and the UART protocol.

The bench suite has two deliberately separate levels:

- **Level 1 — one-shot:** `rc-bench-test` runs a fixed, short profile and exits.
- **Level 2 — live browser:** `rc-bench-live` keeps GPIO open and accepts local
  keyboard keydown/keyup heartbeats from one tokenized browser client.

## Wiring used by the tool

- steering signal: BCM GPIO18, physical pin 12, through a 1 kOhm series resistor;
- ESC signal: BCM GPIO19, physical pin 35, through a 1 kOhm series resistor;
- common ground: Raspberry Pi physical pin 14 to ESC ground and servo ground;
- servo power: verified 5-6 V BEC output, never the Raspberry Pi 5 V rail;
- Raspberry Pi power: its own regulated 5 V supply for this bench test.

The compact wiring diagram is
[`docs/hardware/pi-zero-direct-esc-servo-compact.png`](../../../docs/hardware/pi-zero-direct-esc-servo-compact.png).
The GPIO header pin numbers are the same on Raspberry Pi 4.

## Safety behaviour

- both outputs start at 1500 microseconds (neutral/centre);
- steering is limited to the standard 1000-2000 microsecond range;
- throttle is limited to 1250-1750 microseconds;
- any out-of-range command neutralises and disarms the controller;
- active commands refresh faster than a 250 ms watchdog;
- the final command is always neutral, then PWM is disabled;
- every non-neutral test lasts at most two seconds.

`lgpio` explicitly describes its servo output as software-timed and suitable
for testing only. Do not leave a servo driven by this utility continuously.

## Install and test

```sh
sudo ./install.sh
rc-bench-test gpio-check
rc-bench-test steer-left --dry-run
```

Run real outputs only with the car raised, the motor disconnected for the
first steering tests, and the original transmitter ready to stop the test:

```sh
rc-bench-test neutral
rc-bench-test steer-left
rc-bench-test steer-right
rc-bench-test motor-forward
rc-bench-test motor-reverse
```

The steering commands wait 0.5 seconds at centre, request the standard full
endpoint (1000 or 2000 microseconds) for two seconds, return to centre, then
disable PWM. Stop immediately if the linkage reaches a mechanical stop.

The forward command waits three seconds at neutral, requests a 50% command
(1750 microseconds) for two seconds, returns to neutral, then disables PWM.
The reverse command handles common forward/brake/reverse ESC behaviour: it
requests 1250 microseconds for 0.3 seconds as the brake command, returns to
neutral for 0.5 seconds, then requests 1250 microseconds for two seconds as
the reverse command. An ESC configured for forward/brake-only mode will still
need to be reprogrammed before reverse can work.

## Level 2: local browser keyboard control

Level 2 starts disarmed, never auto-starts at boot, and returns both channels
to neutral if browser heartbeats stop for 200 milliseconds. It accepts one
browser client at a time. A stale client can be replaced after one second.

Start a dependency-free dry run first:

```sh
rc-bench-live --dry-run --host 0.0.0.0 --public-host office.local
```

The command prints a tokenized URL. Open it on the controlling computer, click
**Arm keyboard**, then use:

- `W` / up arrow: 1750 microseconds forward;
- `S` / down arrow: brake-neutral-reverse state machine at 1250 microseconds;
- `A` / left arrow: 1000 microseconds steering;
- `D` / right arrow: 2000 microseconds steering;
- `Space` or `Escape`: neutral and disarm.

For real GPIO, omit `--dry-run`. Keep the car suspended and stop immediately
if the steering linkage reaches a mechanical stop:

```sh
rc-bench-live --host 0.0.0.0 --public-host office.local
```

The service is intentionally transient. To run it detached for one bench
session, use `systemd-run`; to stop, neutralize, and release GPIO, stop the
transient unit:

```sh
sudo systemctl stop rc-bench-live.service
```

## Read-only mode

The installed configuration keeps the system journal in RAM and forces
compressed zram-only swap, so the default zram writeback file does not bypass
the read-only root.

Enable the root overlay and read-only boot partition, then reboot:

```sh
sudo raspi-config nonint enable_overlayfs
sudo raspi-config nonint enable_bootro
sudo reboot
```

To make the root writable again, disable the overlay and reboot:

```sh
sudo raspi-config nonint disable_overlayfs
sudo reboot
```

The boot partition remains read-only by design. To make it writable again,
run this after the first reboot:

```sh
sudo raspi-config nonint disable_bootro
sudo reboot
```
