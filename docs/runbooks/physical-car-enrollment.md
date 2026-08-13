# Physical car enrollment

1. Keep the traction battery disconnected and stop any legacy GPIO owner.
2. Apply database migrations and start the gateway.
3. Run `pnpm --filter @rc/gateway provision-car --slug rc-mania-one --name "RC Mania One"` once.
4. Put the printed one-time code into `RC_ENROLLMENT_CODE` on the Pi and start the agent.
5. After `/var/lib/rc-pi-agent/device.json` exists, remove the enrollment code from the environment.
6. Confirm gateway heartbeat, camera/GPIO/watchdog health, actual video mode, and `AVAILABLE` state.
7. Test browser video and neutral control output with traction power still disconnected.

Do not perform the physical motion test until the traction battery is reconnected with driven wheels suspended.
