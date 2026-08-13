# RC Mania Real Car Enrollment and Direct WebRTC Design

**Date:** 2026-08-13
**Status:** Approved for implementation

## Goal

Connect the first physical car, `RC Mania One`, to the production RC Mania
site. An administrator signed in as `greennmoto@gmail.com` can enter the real
driving flow, select the car, receive live onboard video, and drive it from the
browser. Public users remain in preview mode.

The car uses a Raspberry Pi 4 with an IMX708 Wide NoIR camera. Steering and ESC
signals are connected directly to BCM GPIO18 and GPIO19. There is no ESP32,
battery sensor, or audio device in this version.

## Explicit Constraints

- The Raspberry Pi owns steering and ESC GPIO directly.
- There is no independent microcontroller fail-safe.
- The Pi initiates all Internet connections; no Pi port is exposed publicly.
- The first release is administrator-only and bypasses payment and the public
  queue.
- Video targets 1280x720 at 60 fps and falls back to 30 fps if the Pi cannot
  sustain 60 fps reliably.
- Direct WebRTC is attempted first.
- TURN deployment is prepared as an inactive template and enabled only if
  direct WebRTC cannot connect across the required networks.
- Successful Pi health automatically makes the car `AVAILABLE`.
- With no battery sensor, `AVAILABLE` cannot prove that the traction battery is
  connected. It means only that the Pi, camera, GPIO runtime, and Internet
  connection are healthy.

## Components

### Web application

The existing Next.js application remains the authenticated user interface. New
server routes create administrator drive sessions and issue short-lived,
car-scoped browser tickets. Browser tickets never contain device credentials.

The home and queue screens read operational state from PostgreSQL and require a
fresh online Pi device before showing a car as available.

### RC Gateway

A new long-running Node.js service on the VPS provides:

- one-time device enrollment;
- authenticated device WebSocket connections;
- device heartbeat and presence expiry;
- browser WebSocket connections authenticated by short-lived tickets;
- WebRTC offer, answer, and ICE candidate routing;
- one active controller per car;
- immediate offline transitions on disconnect and periodic stale-device
  reconciliation;
- optional time-limited TURN credentials when TURN is enabled.

The gateway does not carry normal video or driving commands after WebRTC is
established.

Nginx exposes it on same-origin HTTPS paths beneath
`wss://rcmania.live/gateway/`.

### PostgreSQL

Existing `sites`, `cars`, and `devices` records are reused. New persistence
stores:

- hashed device credentials with rotation/revocation metadata;
- one-time enrollment codes as hashes with expiry and one-time consumption;
- administrator drive sessions with car, user, state, and expiry;
- minimal device health metadata needed to explain availability.

Plain device secrets and browser tickets are never stored in PostgreSQL.

### Raspberry Pi Agent

One systemd service owns the complete product runtime:

- GPIO18 steering PWM and GPIO19 ESC PWM;
- neutral-on-start and neutral-on-shutdown;
- IMX708 video capture;
- authenticated outbound gateway connection;
- heartbeat and capability reporting;
- WebRTC peer creation and signaling;
- direct video track and control DataChannels;
- local command validation and watchdog.

The installed local bench controller remains available as files but cannot run
at the same time as the product agent.

## Device Enrollment

1. An administrator creates a short-lived one-time enrollment code.
2. The Pi installer sends the code to the gateway over HTTPS.
3. The gateway consumes the code and returns a random device ID and 256-bit
   device secret once.
4. PostgreSQL stores only a keyed digest of the device secret.
5. The Pi stores its credential in a root-owned mode-0600 environment file.
6. Later boots authenticate with the device ID and secret without repeating
   enrollment.

The first enrollment creates or binds:

- site slug: `rcmania-primary`;
- car slug: `rc-mania-one`;
- car name: `RC Mania One`;
- device kind: `raspberry-pi`.

## Presence and Availability

The Pi sends a heartbeat every five seconds. A heartbeat includes bounded,
versioned health fields: agent version, camera readiness, GPIO readiness,
current video mode, watchdog state, CPU temperature, and Wi-Fi signal when
available.

The gateway accepts health only from the authenticated device. It transitions
the car as follows:

- connection pending or health checks running: `INITIALIZING`;
- current healthy heartbeat and no administrative block: `AVAILABLE`;
- WebSocket disconnect or heartbeat older than 15 seconds: `OFFLINE`;
- camera, GPIO, or watchdog failure: `SAFETY_BLOCKED`;
- explicit administrative block: `ADMIN_BLOCKED`.

Operational web queries independently require an online device with
`last_seen_at` inside the same freshness window. A stale `cars.state` value is
therefore insufficient to display availability.

## Administrator Drive Session

1. The signed-in administrator opens `/preflight`.
2. The web server confirms the `admin` role and fresh car availability.
3. The administrator selects `RC Mania One`.
4. The server creates a short-lived drive session scoped to the user and car.
5. The browser connects to the gateway using a signed, single-purpose browser
   ticket.
6. The gateway binds the browser to the already authenticated Pi and relays
   WebRTC signaling.
7. Once video and both DataChannels are ready, the browser can arm controls.
8. Closing or ending the session revokes control and returns the Pi to neutral.

Payments and the general-user FIFO queue are outside this canary slice.

## WebRTC and Video

The Pi is the WebRTC answerer. The browser creates an offer requesting video
and two DataChannels. Signaling messages are versioned and scoped to the drive
session.

The camera initially attempts 1280x720 at 60 fps. Startup measures whether
capture and encoding remain healthy. If not, the agent reconnects at 30 fps and
reports the selected mode in its heartbeat. The interface displays the actual
mode rather than claiming 60 fps unconditionally.

The initial ICE configuration contains configurable STUN URLs. No TURN server
is required for the first same-network test.

## Driving Protocol and Safety

`control-fast` is unordered with no retransmission. It carries bounded,
versioned frames approximately every 50 milliseconds:

- drive-session ID;
- increasing sequence number;
- steering and throttle axes;
- brake and Nitro flags;
- armed state.

`control-reliable` is ordered and carries arm, neutral, end, and service state
messages.

The Pi does not compare absolute monotonic timestamps from different machines.
It validates local arrival time, session binding, sequence monotonicity, types,
and bounds. The GPIO runtime:

- stays neutral until a valid reliable `ARM` for the current session;
- neutralizes after 200 ms without a fresh valid control frame;
- neutralizes on malformed/replayed frames, browser disconnect, DataChannel
  close, session end, operator stop, process stop, or shutdown;
- implements the existing direction-aware brake/reverse and Nitro semantics;
- allows only one runtime process to claim GPIO.

Because no ESP32 exists, a completely frozen Pi cannot independently generate a
new neutral signal. Physical traction-power disconnection remains the final
safety boundary during tests and maintenance.

## TURN Template

The repository includes an inactive coturn Compose profile and documented
configuration for:

- `turn.rcmania.live`;
- TCP and UDP 3478;
- TLS TCP 5349;
- UDP relay range 49160-49200;
- shared-secret, time-limited credentials generated by the gateway;
- required Namecheap DNS and Google Cloud firewall rules.

TURN credentials are disabled unless an explicit environment flag and shared
secret are configured. Static TURN passwords are never shipped to browsers.

## Raspberry Pi Installation and Overlay Root

The current Pi boots with a temporary `overlayroot`. Deployment therefore uses
this order:

1. disable overlayroot and reboot;
2. verify the writable persistent root;
3. install the agent, systemd unit, dependencies, and credentials;
4. run software-only and camera checks with the traction battery disconnected;
5. enable the agent and verify automatic connection;
6. restore overlayroot and reboot;
7. verify that the installed lower filesystem persists and the agent reconnects
   automatically.

No live steering or motor motion test is performed until the user reconnects
the traction battery with all driven wheels suspended and explicitly requests
the physical test.

## Deployment

The VPS production stack adds only the gateway for the direct test. PostgreSQL
remains persistent and separate. Nginx proxies gateway WebSockets with suitable
upgrade and timeout settings. Health checks cover PostgreSQL, web, and gateway.

The release sequence is database backup, migration, gateway/web replacement,
health verification, enrollment, Pi deployment, end-to-end direct WebRTC test,
and overlayroot restoration. Rollback keeps the previous application images and
can revoke the device credential without modifying other users or cars.

## Verification

Automated verification covers:

- enrollment code expiry and one-time use;
- secret hashing, authentication, revocation, and cross-car isolation;
- heartbeat validation and stale expiry;
- car state transitions and fail-closed operational queries;
- administrator-only session creation;
- browser ticket scope and expiry;
- signaling session isolation and single-controller enforcement;
- control frame bounds, replay rejection, watchdog neutral, brake/reverse, and
  Nitro behavior;
- Compose and Nginx configuration.

Deployment verification covers:

- Pi reconnect after both normal and overlayroot boots;
- correct camera discovery and actual 720p frame rate;
- no public listening port on the Pi other than SSH on the local network;
- healthy gateway WebSocket and five-second heartbeat;
- `RC Mania One` automatically appearing as available;
- signed-out users retaining `COMING SOON`;
- administrator selection and direct WebRTC video;
- controls remaining neutral while the traction battery is disconnected;
- disconnect and watchdog fail paths.

