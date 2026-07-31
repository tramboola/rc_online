# Raspberry Pi direct PWM bench test

This tool is only for a short proof that a Raspberry Pi 4 can control a
standard RC steering servo and a separate ESC through their signal inputs.
It is not the production safety controller. Production rides still require
the ESP32 watchdog and the UART protocol.

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
- steering is limited to 1400-1600 microseconds;
- throttle is limited to 1450-1550 microseconds;
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
```

The motor command waits three seconds at neutral, requests only a 1550
microsecond forward pulse for 0.4 seconds, returns to neutral, then disables
PWM. Some ESCs will not move at this conservative pulse. Do not increase the
range until the exact ESC model and calibration are known.

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
