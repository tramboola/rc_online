# Optional TURN activation

TURN is intentionally inactive for the initial direct-WebRTC trial.

If repeated tests on required networks fail to produce a direct ICE connection:

1. Create `turn.rcmania.live` DNS pointing to the VPS.
2. Allow TCP/UDP 3478, TCP 5349, and UDP 49160-49200 in Google Cloud.
3. Copy `turnserver.conf.template`, replace the shared secret, and provide certificates for TLS.
4. Start `compose.turn.yaml` with the explicit `turn` profile.
5. Configure the same secret in the gateway and issue only time-limited TURN credentials.

Never ship the static shared secret to a browser.
