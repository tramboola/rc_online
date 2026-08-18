# Dedicated TURN fallback rollout

This runbook deploys Coturn to `turn.rcmania.live` (`109.207.172.122`) without changing the OpenVPN container already using UDP 1194 on that host.

## Safety rules

- Run commands against `infra/compose/compose.turn.yaml` or the installed `/opt/rcmania-turn/compose.turn.yaml` only.
- Never run global `docker compose down`, `docker system prune`, or restart the Docker daemon.
- Confirm UDP 1194 is listening before and after every firewall, certificate, or TURN operation.
- Keep `WEBRTC_ICE_TRANSPORT_POLICY=all` except during the short forced-relay acceptance test.
- Do not place the TURN shared secret in Git, shell history, Compose YAML, or `GATEWAY_ICE_SERVERS_JSON`.

## 1. Preflight and OpenVPN baseline

From the TURN VPS:

```bash
getent ahostsv4 turn.rcmania.live
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
ss -lntup
ss -H -lun | grep ':1194 '
df -h /
free -h
```

Stop if DNS does not include `109.207.172.122`, UDP 1194 is absent, or the OpenVPN container is unhealthy.

## 2. Install the isolated project files

Copy these repository files without deleting unrelated directories:

```text
infra/compose/compose.turn.yaml            -> /opt/rcmania-turn/compose.turn.yaml
infra/compose/coturn/entrypoint.sh         -> /opt/rcmania-turn/coturn/entrypoint.sh
infra/compose/coturn/turnserver.conf.template -> /opt/rcmania-turn/coturn/turnserver.conf.template
infra/turn/configure-firewall.sh           -> /usr/local/sbin/rcmania-turn-firewall
infra/turn/verify-turn.sh                   -> /usr/local/sbin/rcmania-turn-verify
infra/turn/reload-turn-after-renewal.sh     -> /usr/local/sbin/rcmania-turn-reload
infra/turn/renew-turn-certificate.sh        -> /usr/local/sbin/rcmania-turn-renew
infra/turn/rcmania-turn-renew.service       -> /etc/systemd/system/rcmania-turn-renew.service
infra/turn/rcmania-turn-renew.timer         -> /etc/systemd/system/rcmania-turn-renew.timer
```

Set root ownership and executable mode only on the installed shell scripts.

## 3. Create and distribute the shared secret

Generate the secret once on the TURN VPS:

```bash
install -d -m 0700 /etc/rcmania-turn
umask 077
openssl rand -base64 48 > /etc/rcmania-turn/turn_shared_secret
chmod 0600 /etc/rcmania-turn/turn_shared_secret
```

Securely copy the exact same file to `/etc/rcmania/turn_shared_secret` on the Google application VPS. The web and gateway containers run as UID/GID `10001`, so make the file root-owned and group-readable by that container group:

```bash
chown root:10001 /etc/rcmania/turn_shared_secret
chmod 0640 /etc/rcmania/turn_shared_secret
```

Do not print its contents. The TURN VPS copy remains root-only with mode `0600`.

Create `/opt/rcmania-turn/.env` with mode `0600`:

```dotenv
TURN_EXTERNAL_IP=109.207.172.122
TURN_SHARED_SECRET_PATH=/etc/rcmania-turn/turn_shared_secret
```

## 4. Preserve OpenVPN and enable the host firewall

```bash
/usr/local/sbin/rcmania-turn-firewall
ss -H -lun | grep ':1194 '
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

The script first opens 22/TCP and 1194/UDP, then 80/TCP, 3478/UDP+TCP, 443/TCP, and 49160-49259/UDP. It does not reset UFW or manipulate Docker containers.

## 5. Issue the TLS certificate

Install Certbot and obtain the initial certificate while TCP 80 is free:

```bash
apt-get update
apt-get install -y certbot
certbot certonly --standalone --non-interactive --agree-tos --email "$ACME_EMAIL" -d turn.rcmania.live
test -r /etc/letsencrypt/live/turn.rcmania.live/fullchain.pem
test -r /etc/letsencrypt/live/turn.rcmania.live/privkey.pem
```

Install and enable the repository-owned renewal timer:

```bash
systemctl daemon-reload
systemctl enable --now rcmania-turn-renew.timer
systemctl list-timers rcmania-turn-renew.timer
```

The deploy hook restarts only the Coturn service and verifies that OpenVPN still listens before and after that restart.

## 6. Start and verify Coturn

```bash
cd /opt/rcmania-turn
docker compose --project-name rcmania-turn --env-file .env --file compose.turn.yaml config
docker compose --project-name rcmania-turn --env-file .env --file compose.turn.yaml pull turn
docker compose --project-name rcmania-turn --env-file .env --file compose.turn.yaml up -d turn
docker compose --project-name rcmania-turn --env-file .env --file compose.turn.yaml ps
docker compose --project-name rcmania-turn --env-file .env --file compose.turn.yaml logs --tail=100 turn
/usr/local/sbin/rcmania-turn-verify
ss -H -lun | grep ':1194 '
```

The verification script checks DNS, the TLS certificate, authenticated UDP/TCP/TLS allocations, Compose health, UFW state, and OpenVPN presence.

## 7. Enable temporary credentials on the Google VPS

The private application environment must contain:

```dotenv
TURN_SHARED_SECRET_PATH=/etc/rcmania/turn_shared_secret
TURN_CREDENTIAL_TTL_SECONDS=600
WEBRTC_ICE_TRANSPORT_POLICY=all
GATEWAY_ICE_SERVERS_JSON=[{"urls":"stun:turn.rcmania.live:3478"},{"urls":"turn:turn.rcmania.live:3478?transport=udp"},{"urls":"turn:turn.rcmania.live:3478?transport=tcp"},{"urls":"turns:turn.rcmania.live:443?transport=tcp"}]
```

Recreate only the RC Mania web and gateway services after their new images are built. Confirm `/health/ready`, a direct session, and that no long-lived TURN password appears in the returned JSON.

## 8. Update the Raspberry Pi

Deploy the matching Pi agent package, restart only `rc-pi-agent.service`, and confirm its heartbeat. The agent must receive all ICE entries in `session.start`; temporary credentials are held only for the active peer connection.

Keep traction power disconnected or the wheels safely raised for the first post-update session.

## 9. Forced TURN acceptance test

Temporarily set `WEBRTC_ICE_TRANSPORT_POLICY=relay` on the Google VPS and recreate only the web service. Start one admin drive session and verify:

- the loading log reports `TURN fallback connection established`;
- the ride screen shows `CONNECTION TURN`;
- real video and keyboard controls operate;
- Coturn traffic increases while the session is active;
- OpenVPN remains connected.

Immediately restore `WEBRTC_ICE_TRANSPORT_POLICY=all`, recreate only the web service, and verify the normal local-network session reports `DIRECT`.

## Monitoring

```bash
docker compose --project-name rcmania-turn --env-file /opt/rcmania-turn/.env --file /opt/rcmania-turn/compose.turn.yaml ps
docker compose --project-name rcmania-turn --env-file /opt/rcmania-turn/.env --file /opt/rcmania-turn/compose.turn.yaml logs --since=30m turn
docker stats --no-stream
ss -s
ufw status verbose
systemctl status rcmania-turn-renew.timer
```

For four simultaneous 720p cars, watch total server traffic and CPU. Investigate sustained network use above 120 Mbit/s, memory above 300 MiB, repeated allocation failures, or any OpenVPN interruption.

## Rollback

1. Set the Google VPS ICE JSON back to STUN-only and keep policy `all`.
2. Recreate only the web and gateway containers using the previous immutable image tag.
3. Restore the previous Pi agent package and restart only `rc-pi-agent.service`.
4. Stop only Coturn:

```bash
docker compose --project-name rcmania-turn --env-file /opt/rcmania-turn/.env --file /opt/rcmania-turn/compose.turn.yaml stop turn
```

5. Leave OpenVPN, Docker, certificates, and the secret files untouched until the incident is understood.
