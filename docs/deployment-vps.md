# VPS web demo deployment

This deployment publishes only the Next.js simulation UI. It does not enable
real vehicles, payments, accounts, the API, or the edge/media control plane.

## Deploy

```bash
export RC_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose -f infra/compose/compose.vps-web.yaml config
docker compose -f infra/compose/compose.vps-web.yaml build web
docker compose -f infra/compose/compose.vps-web.yaml up -d --no-build web
curl --fail http://127.0.0.1:3000/
```

Nginx terminates public HTTP and proxies only to the loopback-bound application
port. Add the real domain and HTTPS certificate after DNS points to the VM's
static address.

## Verify

```bash
docker compose -f infra/compose/compose.vps-web.yaml ps
docker inspect --format '{{json .State.Health}}' rcmania-web-1
curl --fail --header 'Host: rcmania.local' http://127.0.0.1/
```

## Roll back

Keep the previous immutable `rcmania-web:<git-sha>` image. To roll back, select
its tag and recreate only the web container:

```bash
export RC_IMAGE_TAG="<previous-git-sha>"
docker compose -f infra/compose/compose.vps-web.yaml up -d --no-build web
curl --fail http://127.0.0.1:3000/
```
