# RC Mania Pi agent OTA runbook

Pi agent updates are immutable Python zip applications signed with Ed25519.
The application VPS stores the signing key as a root-only operational secret;
Git and application containers never receive it. The Pi stores only the public
key and connects outbound to the existing gateway.

## One-time key setup on the application VPS

```bash
sudo install -d -o root -g root -m 0700 /opt/rcmania/shared/ota-signing
sudo openssl genpkey -algorithm Ed25519 \
  -out /opt/rcmania/shared/ota-signing/pi-agent-ed25519.pem
sudo chmod 0600 /opt/rcmania/shared/ota-signing/pi-agent-ed25519.pem
sudo openssl pkey \
  -in /opt/rcmania/shared/ota-signing/pi-agent-ed25519.pem \
  -pubout -out /opt/rcmania/shared/ota-signing/pi-agent-ed25519-public.pem
sudo chmod 0644 /opt/rcmania/shared/ota-signing/pi-agent-ed25519-public.pem
sudo install -d -o root -g www-data -m 0750 /opt/rcmania/shared/agent-releases
```

Back up the private key offline. Losing it prevents future OTA releases;
exposing it requires replacing the trusted public key over SSH.

## Build and publish a release

Run the builder from an exact reviewed Pi repository SHA:

```bash
python image/scripts/build-ota-artifact.py \
  --source pi-agent \
  --output /tmp/rcmania-agent-release \
  --version 0.4.1 \
  --runtime-generation 1 \
  --private-key /opt/rcmania/shared/ota-signing/pi-agent-ed25519.pem
sudo install -o root -g www-data -m 0640 \
  /tmp/rcmania-agent-release/rc-pi-agent-0.4.1.pyz \
  /tmp/rcmania-agent-release/rc-pi-agent-0.4.1.json \
  /opt/rcmania/shared/agent-releases/
curl --fail --silent --show-error \
  https://rcmania.live/agent-releases/rc-pi-agent-0.4.1.pyz \
  -o /tmp/public-agent.pyz
sha256sum /tmp/public-agent.pyz
```

Compare the printed digest with the manifest, then register it once:

```bash
docker compose --env-file /opt/rcmania/shared/auth.env \
  -f infra/compose/compose.vps-web.yaml exec -T gateway \
  node dist/register-agent-release.js /agent-releases/rc-pi-agent-0.4.1.json
```

Registration refuses an existing component/version pair. Never overwrite a
published `.pyz` or manifest; use a new semantic version.

## Request and inspect an update

Use an authenticated administrator browser session:

```text
POST /api/admin/device-updates
{"carId":"<car UUID>","version":"0.4.1"}

GET /api/admin/device-updates?carId=<car UUID>
```

The request is rejected while the car has an active drive. A capable idle Pi
claims it once, validates and stages it, then the root-owned local updater
switches A/B slots. Success requires the new exact version to reconnect and
write its health marker within 90 seconds. Otherwise the previous slot is
restored automatically and the job is not retried.

Before the first real update, disconnect traction power or raise every driven
wheel. Inspect:

```bash
systemctl status rc-pi-agent.service rc-pi-agent-update.path
journalctl -u rc-pi-agent-update.service -u rc-pi-agent.service --since today
cat /var/lib/rc-pi-agent/update-result.json
ls -l /boot/firmware/rc-pi-agent/
```

To roll back deliberately, request a previously registered version. An
automatic rollback keeps `previous.pyz` and records a failed, terminal job.
