#!/bin/sh
set -eu

test ! -e /home/tramboola/.rc-overlay-volatile-test
echo "OVERLAY_MARKER_DISCARDED"

findmnt -no FSTYPE,SOURCE,OPTIONS /
findmnt -no FSTYPE,SOURCE,OPTIONS /boot/firmware

root_fs=$(findmnt -no FSTYPE /)
test "$root_fs" = "overlay"
findmnt -no OPTIONS /boot/firmware | grep -qw ro

test -x /usr/local/bin/rc-bench-test
rc-bench-test gpio-check

swap_names=$(/sbin/swapon --show --noheadings | awk '{print $1}' | xargs)
test "$swap_names" = "/dev/zram0"
test -z "$(systemctl list-timers rpi-zram-writeback.timer --no-legend --no-pager)"

cd /tmp/pi-direct-pwm
python3 -m unittest discover -s tests -q

ip -br address show eth0
ip -br address show wlan0
vcgencmd get_throttled
echo "REMOTE_VERIFICATION_OK"
