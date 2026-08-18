#!/bin/sh
set -eu

secret_file=/run/secrets/turn_shared_secret
template_file=/etc/coturn/turnserver.conf.template
runtime_file=/run/coturn/turnserver.conf

if [ ! -r "$secret_file" ]; then
  echo "TURN shared secret file is not readable" >&2
  exit 1
fi
if [ ! -r "$template_file" ]; then
  echo "Coturn configuration template is not readable" >&2
  exit 1
fi
if [ -z "${TURN_EXTERNAL_IP:-}" ]; then
  echo "TURN_EXTERNAL_IP is required" >&2
  exit 1
fi

shared_secret=$(tr -d '\r\n' < "$secret_file")
if [ "${#shared_secret}" -lt 32 ]; then
  echo "TURN shared secret must contain at least 32 characters" >&2
  exit 1
fi

umask 077
sed "s/{{TURN_EXTERNAL_IP}}/$TURN_EXTERNAL_IP/g" "$template_file" > "$runtime_file"
printf '\nstatic-auth-secret=%s\n' "$shared_secret" >> "$runtime_file"
unset shared_secret

exec turnserver -c "$runtime_file"
