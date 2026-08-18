#!/bin/sh
set -eu

turn_host=${TURN_HOST:-turn.rcmania.live}
turn_ip=${TURN_EXTERNAL_IP:-109.207.172.122}
compose_file=${TURN_COMPOSE_FILE:-/opt/rcmania-turn/compose.turn.yaml}
compose_env_file=${TURN_ENV_FILE:-/opt/rcmania-turn/.env}
secret_file=${TURN_SHARED_SECRET_PATH:-/etc/rcmania-turn/turn_shared_secret}

if ! getent ahostsv4 "$turn_host" | awk '{print $1}' | grep -Fxq "$turn_ip"; then
  echo "$turn_host does not resolve to $turn_ip" >&2
  exit 1
fi
if [ ! -r "$secret_file" ]; then
  echo "TURN shared secret is not readable" >&2
  exit 1
fi
if ! ss -H -lun | grep -Eq '(^|[[:space:]])[^[:space:]]*:1194[[:space:]]'; then
  echo "OpenVPN is not listening on UDP 1194" >&2
  exit 1
fi

certificate_subject=$(openssl s_client -connect "$turn_host:443" -servername "$turn_host" </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName)
printf '%s\n' "$certificate_subject" | grep -Fq "DNS:$turn_host"

expires=$(($(date +%s) + 600))

run_allocation_test() {
  transport=$1
  shift
  username="$expires:deployment-smoke-$transport"
  credential=$(TURN_SMOKE_USERNAME="$username" TURN_SMOKE_SECRET_FILE="$secret_file" python3 -c 'import base64, hashlib, hmac, os, pathlib; secret = pathlib.Path(os.environ["TURN_SMOKE_SECRET_FILE"]).read_text().strip().encode(); username = os.environ["TURN_SMOKE_USERNAME"].encode(); print(base64.b64encode(hmac.new(secret, username, hashlib.sha1).digest()).decode())')
  docker compose --project-name rcmania-turn --env-file "$compose_env_file" --file "$compose_file" exec -T turn \
    turnutils_uclient -u "$username" -w "$credential" -c -m 1 -n 1 "$@" -y "$turn_host"
}

run_allocation_test udp -p 3478
run_allocation_test tcp -t -p 3478
run_allocation_test tls -S -t -p 443

docker compose --project-name rcmania-turn --env-file "$compose_env_file" --file "$compose_file" ps
ufw status verbose
