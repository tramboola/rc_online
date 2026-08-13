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

- `W` / up arrow: forward at 63%;
- hold `N` together with `W` / up arrow: forward Nitro at 100%; `N` alone,
  during reverse, or while braking has no effect;
- `S` / down arrow: from unknown or forward direction, 60 ms fixed brake and
  60 ms neutral before reverse at 63%; after completed reverse and ordinary
  neutral, another `S` resumes reverse immediately;
- `Space`: direction-aware brake while held; after forward it sends the reverse
  brake endpoint, after reverse it sends the forward brake endpoint, and
  steering stays active; releasing a reverse-origin brake while `S` remains
  held sends 60 ms neutral before resuming reverse, never 1250 microseconds;
- `A` / left arrow and `D` / right arrow: full steering, including while braking;
- `Escape` or Stop: neutral and disarm.

The 63% drive setting means 1658 microseconds forward and 1342 microseconds
reverse, relative to the verified 1250-1750 microsecond stand cap. Nitro is
1750 microseconds forward. These commands never unlock the ESC's full pulse
range.

The initial reverse handshake is used only when the remembered drive direction
is unknown or forward. Once reverse has completed, ordinary armed neutral keeps
that direction knowledge, so another `S` request returns directly to the fixed
1342 microsecond reverse command. If `Space` interrupted completed reverse,
releasing it while `S` remains held first uses only the configured reverse
neutral interval, then returns to 1342 microseconds; that re-entry path never
outputs 1250 microseconds.

The brake and neutral phases each default to 60 milliseconds. Tune them for a
particular ESC, within the 20-1000 millisecond bounds, for example:

```sh
rc-bench-live --host 0.0.0.0 --public-host office.local \
  --reverse-brake-ms 120 --reverse-neutral-ms 80
```

If the ESC does not recognise reverse, increase the neutral interval first.

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
