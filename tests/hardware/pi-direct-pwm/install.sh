#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -m 0755 /opt/rc-bench-control/rc_bench
install -m 0644 "$script_dir"/rc_bench/*.py /opt/rc-bench-control/rc_bench/
install -m 0755 "$script_dir"/bin/rc-bench-test /usr/local/bin/rc-bench-test
install -m 0755 "$script_dir"/bin/rc-bench-live /usr/local/bin/rc-bench-live
install -d -m 0755 /opt/rc-bench-control/web
install -m 0644 "$script_dir"/web/live.html /opt/rc-bench-control/web/live.html
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 \
  "$script_dir"/config/80-rc-readonly-journal.conf \
  /etc/systemd/journald.conf.d/80-rc-readonly-journal.conf
install -d -m 0755 /etc/rpi/swap.conf.d
install -m 0644 \
  "$script_dir"/config/90-rc-readonly-zram.conf \
  /etc/rpi/swap.conf.d/90-rc-readonly-zram.conf

cd /opt/rc-bench-control
python3 -m compileall -q rc_bench
python3 -c 'import lgpio; from rc_bench.cli import LIMITS; assert LIMITS.watchdog_ms == 250'
