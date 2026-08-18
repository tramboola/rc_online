#!/bin/sh
set -eu

compose_file=${TURN_COMPOSE_FILE:-/opt/rcmania-turn/compose.turn.yaml}
compose_env_file=${TURN_ENV_FILE:-/opt/rcmania-turn/.env}

if ! ss -H -lun | grep -Eq '(^|[[:space:]])[^[:space:]]*:1194[[:space:]]'; then
  echo "OpenVPN is not listening; refusing TURN restart" >&2
  exit 1
fi

docker compose --project-name rcmania-turn --env-file "$compose_env_file" --file "$compose_file" restart turn

if ! ss -H -lun | grep -Eq '(^|[[:space:]])[^[:space:]]*:1194[[:space:]]'; then
  echo "OpenVPN stopped listening after TURN restart" >&2
  exit 1
fi
