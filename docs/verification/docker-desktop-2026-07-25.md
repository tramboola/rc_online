# Docker Desktop repair evidence — 2026-07-25

## Host and WSL

- Windows 10 Pro 22H2, build `19045.5371`.
- `LanmanServer` is enabled with `AUTO_START`.
- No pending CBS, Windows Update, or file-rename reboot flag was present.
- WSL was upgraded from the legacy inbox implementation (kernel `5.10.16`,
  without `wsl --version`) to WSL `2.7.11.0`, kernel
  `6.18.33.2-2`.

## Docker Desktop installation

- Installed Docker Desktop `4.83.0.234302` in recommended per-user mode.
- Backend: WSL 2.
- Windows Containers: disabled.
- Docker Engine: `29.6.2`, Linux/amd64.
- Docker Compose: `v5.3.1`.
- Active context: `desktop-linux`.

The installer was downloaded from Docker's official Windows x86_64 endpoint.
Its measured SHA-256 was:

```text
d812d89da0cda66c97cdf9decb60debf17d71c358900db33c48eb9ee9604f40c
```

This exactly matched Docker's published checksum for build `234302`.
Authenticode status was `Valid`; signer was `Docker Inc`.

## Verification

- `docker desktop status`: `running`.
- Docker client and server negotiation: passed.
- `docker run --rm hello-world`: passed.
- Pulled digest:
  `sha256:c3cbe1cc1aa588a64951ac6286e0df7b27fe2e6324b1001c619bb358770c0178`.
- No containers or volumes existed after the auto-removed smoke test.
- `docker compose -f infra/compose/compose.yaml --profile core --profile sim
  --profile obs config --quiet`: passed.

The follow-up full-stack verification completed on 2026-07-27. See
`docs/verification/compose-2026-07-27.md`. No existing Docker volumes or user
data were deleted during the repair or full-stack startup.
