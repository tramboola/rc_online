#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root" >&2
  exit 1
fi

if ! ss -H -lun | grep -Eq '(^|[[:space:]])[^[:space:]]*:1194[[:space:]]'; then
  echo "OpenVPN is not listening on UDP 1194; refusing to change the firewall" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ufw
fi

ufw allow 22/tcp comment 'SSH'
ufw allow 1194/udp comment 'Existing OpenVPN'
ufw allow 80/tcp comment 'ACME HTTP challenge'
ufw allow 3478/udp comment 'TURN UDP'
ufw allow 3478/tcp comment 'TURN TCP'
ufw allow 443/tcp comment 'TURN TLS'
ufw allow 49160:49259/udp comment 'TURN relay range'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw reload

if ! ss -H -lun | grep -Eq '(^|[[:space:]])[^[:space:]]*:1194[[:space:]]'; then
  echo "OpenVPN stopped listening after firewall activation" >&2
  exit 1
fi

ufw status verbose
