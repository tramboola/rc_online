# Dedicated TURN Fallback Design

## Goal

Provide a production TURN fallback for RC Mania WebRTC sessions without routing healthy direct sessions through the relay and without disturbing the OpenVPN container already running on the dedicated Serverspace VPS.

## Scope

This change covers four cooperating pieces:

1. a dedicated Coturn service at `turn.rcmania.live` on `109.207.172.122`;
2. short-lived TURN REST credentials issued by both the web session endpoint and the signaling gateway;
3. browser route detection so the ride screen reports `DIRECT` or `TURN` truthfully;
4. Raspberry Pi consumption of the ICE server list carried by `session.start`.

The first deployment supports one TURN server and up to four simultaneous cars. A second `turn2.rcmania.live` server is deliberately outside this scope.

## Architecture

The browser and Raspberry Pi receive the same ordered ICE server templates: public STUN first, then TURN over UDP, TCP, and TLS. Both peers use the default WebRTC policy (`all`), so ICE may test relay candidates but prefers a viable direct candidate pair. Media uses Coturn only when the selected pair contains a relay candidate.

```text
Browser -- WSS signaling --> Google VPS gateway <-- WSS signaling -- Raspberry Pi
    \                                                         /
     +------- direct WebRTC candidate pair when viable -------+
     \                                                         /
      +-- fallback allocations --> turn.rcmania.live <--------+
```

Coturn runs as its own Docker Compose project named `rcmania-turn` with host networking. It does not join, restart, or remove the existing OpenVPN container or its networks. OpenVPN keeps UDP 1194; Coturn uses UDP/TCP 3478, TCP 443, and UDP 49160-49259. TCP 80 is used only for certificate issuance and renewal.

## TURN Authentication

The long-lived shared secret is never committed, embedded in an image, returned by an API, or supplied as a browser credential. It is stored in root-readable files on the Google and TURN hosts and mounted as a Docker secret.

For every drive session, the web service and gateway independently issue Coturn REST credentials:

- username: `<expiry-unix-seconds>:<session-id>`;
- credential: Base64-encoded HMAC-SHA1 of the username using the shared secret;
- lifetime: 600 seconds;
- maximum configured lifetime: 3600 seconds.

The web endpoint includes credentials in the session response used to create the browser peer connection. The gateway generates a fresh credential when it attaches the browser, then includes it in `session.start` for the Pi. Different temporary credentials for the two peer allocations are valid and avoid passing a browser-generated secret through the signaling store.

Static `username` or `credential` fields in `GATEWAY_ICE_SERVERS_JSON` are rejected. A TURN URL without an available shared-secret file fails closed at application startup/request construction rather than silently offering unusable TURN.

## ICE Configuration

The production template is:

```json
[
  {"urls":"stun:turn.rcmania.live:3478"},
  {"urls":"turn:turn.rcmania.live:3478?transport=udp"},
  {"urls":"turn:turn.rcmania.live:3478?transport=tcp"},
  {"urls":"turns:turn.rcmania.live:443?transport=tcp"}
]
```

`iceTransportPolicy` remains `all`; `relay` is used only during a controlled acceptance test. The application reports `DIRECT`, `TURN`, or `CONNECTED` when browser statistics do not expose enough candidate information.

## Coturn Container

Coturn uses a pinned official image and a repository-owned configuration template. At startup, a small entrypoint copies the template into tmpfs and appends the Docker secret, keeping the secret out of the repository and container metadata.

Required configuration:

- realm and server name `turn.rcmania.live`;
- TURN REST authentication with fingerprinting and stale nonces;
- UDP/TCP listener on 3478;
- TLS listener on 443 with the Let's Encrypt certificate;
- relay range 49160-49259/UDP;
- no anonymous access, CLI, multicast peers, loopback peers, TCP relay endpoints, or obsolete TLS versions;
- stdout logging with Docker log rotation;
- bounded CPU, memory, processes, and restart behavior.

Certificates are issued and renewed on the host with Certbot. A repository-owned systemd service/timer renews certificates and restarts only the `rcmania-turn` Compose project when renewal succeeds.

## Firewall and OpenVPN Isolation

Before enabling UFW, the deployment procedure explicitly allows:

- 22/TCP for SSH;
- 1194/UDP for the existing OpenVPN service;
- 80/TCP for ACME HTTP validation;
- 3478/UDP and 3478/TCP;
- 443/TCP;
- 49160-49259/UDP.

The procedure records the OpenVPN container state and validates UDP 1194 and the container health before and after each firewall or Coturn operation. It never runs global `docker compose down`, `docker system prune`, or restarts the Docker daemon.

## Browser Behavior and Observability

After the peer enters `connected`, the browser inspects the selected ICE candidate pair. A relay candidate produces `TURN`; otherwise a resolved pair produces `DIRECT`. An unavailable or incomplete stats report produces `CONNECTED`, not a misleading direct claim.

The loading log accepts both direct and TURN connections as ready once a real camera frame is decoded. It records a route-specific message before hiding the loading overlay.

## Raspberry Pi Behavior

The Pi validates the `iceServers` array from `session.start` and builds an aiortc `RTCConfiguration` containing `RTCIceServer` entries. Malformed entries fail the session closed and neutralize controls. The Pi does not persist temporary TURN credentials.

No GPIO, PWM, camera, reverse, Nitro, or safety-watchdog behavior changes in this work.

## Testing and Rollout

Local tests cover the REST HMAC format, expiration, static-credential rejection, web and gateway issuance, browser route detection, loading readiness for both routes, and Pi ICE mapping and validation. TypeScript type checking/build and the complete Pi pytest suite must pass.

Deployment is staged:

1. validate DNS and back up/record the TURN host state;
2. preserve and test OpenVPN;
3. install firewall rules and certificate tooling;
4. start only `rcmania-turn` and run authenticated UDP/TCP/TLS allocation tests;
5. deploy Google VPS web/gateway with ICE templates and the shared secret;
6. deploy the Pi agent;
7. force `relay` in a controlled test with the car wheels safely raised or traction power disconnected;
8. restore policy `all` and verify a normal direct session plus a forced TURN session.

Rollback removes TURN templates from the Google VPS configuration, redeploys the previous immutable application images, restores the prior Pi package, and stops only the `rcmania-turn` Compose project. OpenVPN remains untouched throughout.
