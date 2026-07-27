# Contributing

Use Node 22 and the pinned pnpm major. Before opening a pull request run
`pnpm check`; for device changes also run `pio test -e native` in
the sibling repository `../tether-rally-mjx`.

Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`,
`refactor:`, `test:`, `chore:`). Pull requests that change authentication,
billing, WebRTC, certificates, UART, or update delivery require a security diff
review and a CODEOWNER.

Never commit `.env` files, API keys, device certificates, TURN credentials,
payment data, or camera URLs. GitHub Issues are the sole task tracker.
