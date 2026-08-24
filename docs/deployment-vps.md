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

Keep the deployment environment outside the repository with owner-only
permissions (`0600`). In addition to the existing auth and Google OAuth
variables, the account service requires:

```dotenv
AUTH_RATE_LIMIT_SECRET=<32 random bytes encoded as 64 lowercase hex characters>
RESEND_API_KEY=<server-only Resend API key>
AUTH_EMAIL_FROM=RC Mania <accounts@updates.rcmania.live>
AUTH_SUPPORT_EMAIL=support@rcmania.live
```

Generate `AUTH_RATE_LIMIT_SECRET` independently from `AUTH_SECRET`. Never add
either secret to Git, Docker image layers, browser variables, screenshots, or
deployment logs. In particular, never create a `NEXT_PUBLIC_RESEND_API_KEY`.

Before the first account migration and before every account-related release,
take a PostgreSQL backup and verify that it is non-empty. Keep the backup
outside the release directory:

```bash
install -d -m 0700 /opt/rcmania/backups
docker compose -f infra/compose/compose.vps-web.yaml exec -T postgres \
  pg_dump -U rcmania -d rcmania -Fc \
  > "/opt/rcmania/backups/rcmania-before-${RC_IMAGE_TAG}.dump"
test -s "/opt/rcmania/backups/rcmania-before-${RC_IMAGE_TAG}.dump"
```

The `migrate` service applies the account schema before the web container is
recreated. If migration fails, do not start the new web image. Restore only
after stopping RC Mania services and confirming the selected backup and target
database.

Create the immutable OTA release directory once and keep it outside release
worktrees:

```bash
sudo install -d -o root -g www-data -m 0750 /opt/rcmania/shared/agent-releases
```

The deployment must also install `infra/nginx/rcmania.conf` before reloading
Nginx so `https://rcmania.live/agent-releases/` serves these files directly.
See `docs/runbooks/pi-agent-ota.md` for signing and rollout.

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
