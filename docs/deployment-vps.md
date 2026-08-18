# RC Mania application VPS deployment

This deployment publishes the Next.js application, PostgreSQL migrations, and
the device/signaling gateway. Coturn runs on its own VPS and Compose project;
see `docs/runbooks/turn-enable.md`.

The private deployment environment must define `TURN_SHARED_SECRET_PATH` as a
root-owned `0640` file with group `10001`, containing the same secret as the
TURN host. This lets the non-root web and gateway containers read the
Compose-mounted secret without exposing it to other host users. Keep
`GATEWAY_ICE_SERVERS_JSON` URL-only: the web and gateway services derive
short-lived credentials per drive session.

## Deploy

```bash
export RC_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose -f infra/compose/compose.vps-web.yaml config
docker compose -f infra/compose/compose.vps-web.yaml build web gateway migrate
docker compose -f infra/compose/compose.vps-web.yaml up -d --no-build postgres migrate web gateway
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:3002/health/ready
```

Nginx terminates public HTTP and proxies only to the loopback-bound application
port. Add the real domain and HTTPS certificate after DNS points to the VM's
static address.

## Verify

```bash
docker compose -f infra/compose/compose.vps-web.yaml ps
docker inspect --format '{{json .State.Health}}' rcmania-web-1
docker inspect --format '{{json .State.Health}}' rcmania-gateway-1
curl --fail --header 'Host: rcmania.local' http://127.0.0.1/
```

## Roll back

Keep the previous immutable web, gateway, and migration images. To roll back,
select the previous tag and recreate only RC Mania services:

```bash
export RC_IMAGE_TAG="<previous-git-sha>"
docker compose -f infra/compose/compose.vps-web.yaml up -d --no-build web gateway
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:3002/health/ready
```
