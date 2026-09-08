# Adaptive onboard video

The browser and `../tether-rally-mjx/pi-agent` must both include the adaptive-video
change to enable automatic profile selection. No database migration or gateway
contract change is required. The optional `video-quality` WebRTC data channel is
separate from driving controls. An older Pi still streams normally to the new
browser, but cannot change profiles; an older browser ignores the new Pi's channel.

## Profiles and selection

| Profile | Encoded dimensions | Target frame rate |
| --- | --- | --- |
| 720p60 | 1280 × 720 | 60 FPS |
| 720p30 | 1280 × 720 | 30 FPS |
| 540p30 | 960 × 540 | 30 FPS |
| 360p30 | 640 × 360 | 30 FPS |

The Pi starts each session at its best supported profile. If camera startup falls
back to 30 FPS, 720p60 is not advertised. There is no profile below 360 pixels high.
The camera keeps its 720p capture configuration; the session track scales frames
before encoding, limits output frame rate, and uses a monotonic timestamp timeline.
Conversion and resizing run outside the control event loop. Profile switches do
not restart the camera or the peer connection.

The browser samples inbound-video statistics approximately once per second,
without overlapping requests. After a 3-second warmup, three consecutive impaired
observations request a downgrade. An impaired observation has any of:

- measured decoded FPS strictly below 21 (including zero);
- selected connection RTT above 250 ms;
- packet-arrival jitter above 50 ms;
- interval packet loss above 5%;
- interval average jitter-buffer residence above 150 ms;
- decoded-frame counter not advancing during a fresh sample interval.

Three consecutive samples below 21 FPS skip to the next supported **lower
resolution**, independently of the target frame rate:

| Current profile | Low-FPS downgrade |
| --- | --- |
| 720p60 or 720p30 (1280 × 720) | 540p30 (960 × 540) |
| 540p30 (960 × 540) | 360p30 (640 × 360) |
| 360p30 (640 × 360) | Stay at the minimum; do not upgrade while FPS is low |

Exactly 21 FPS does not trigger this rule. A recovered or unknown FPS sample
breaks the low-FPS streak; one isolated dip cannot bypass 720p30. Three impaired
samples with mixed causes (for example, two low-FPS samples followed by network
impairment) still follow the original one-profile ladder, including 720p60 to
720p30. If the Pi does not advertise 540p30, use the next supported lower
resolution; if none is available, a lower-FPS profile is the fallback.

After each acknowledged change, the controller waits 8 seconds before gathering
new evidence. It moves one profile upward only after at least 6 seconds of good
observations: measured FPS at least 21, RTT below 160 ms, jitter below 25 ms, loss
below 1%, and buffer delay below 80 ms when available. Missing statistics are
unknown, never evidence of a healthy connection. Long gaps and counter/stream
resets discard outdated evidence. Lost-packet counters may be signed; recovered
or duplicated packets cannot produce a negative interval loss percentage.

These are initial conservative thresholds, not hardware-tuned guarantees.
Reducing resolution cannot remove propagation delay or repair a disconnected
network. RTT is not an end-to-end camera-to-display latency measurement.

## Optional protocol

The Pi creates the ordered `video-quality` channel and sends:

```json
{"v":1,"type":"video.capabilities","sessionId":"<current-session>","profiles":["720p60","720p30","540p30","360p30"],"profile":"720p60"}
```

Only after a valid capability message does the browser request a profile:

```json
{"v":1,"type":"video.profile.request","sessionId":"<current-session>","profile":"360p30"}
```

The Pi acknowledges the selected track profile:

```json
{"v":1,"type":"video.profile.applied","sessionId":"<current-session>","profile":"360p30"}
```

Both ends restrict messages to the current session and supported profiles. The Pi
coalesces bursts into one pending request, with at least 2 seconds between changes.
The browser waits for acknowledgement before advancing its policy state; unanswered
requests expire after 5 seconds and retry only with fresh evidence, at most three
times before waiting for acknowledgement or a new connection. Malformed optional
messages do not change throttle, steering, arming, or session lifetime. Closing
the ride cancels statistics polling and pending video work.

## Display

The compact text under connection/battery status is visible on desktop and mobile:
`1280×720 · 29 FPS`. Dimensions come from received video statistics (with the video
element's actual dimensions as fallback), and FPS from interval decoded-frame
counts or the browser's measured inbound FPS. Target profile FPS is not substituted
for measured FPS. Unknown FPS is `— FPS`; no video measurement is `VIDEO · —`.

Statistics follow the [W3C WebRTC Statistics specification](https://www.w3.org/TR/webrtc-stats/).

## Verification and rollout

Local automated coverage includes sampling math, missing/reset/signed counters,
downgrade/recovery hysteresis and floor, optional protocol compatibility, late
responses after closure, and live React label updates. Pi tests establish real
local WebRTC connections using synthetic camera frames with VP8 and H.264, and
verify decoded resolution changes while driving-command handling stays intact.

Before deployment, test on the actual Pi and iPhone: camera startup at 60/30 FPS,
CPU/temperature, a sustained weak-network interval, recovery to higher profiles,
and session replacement/closure. Use a stationary car for these acceptance checks.
This preparation does not deploy or update either VPS or Raspberry Pi.

To enable on the service later, deploy the Pi Agent and the web release from their
matching `codex/adaptive-video-360p` branches. No gateway restart is needed for this
feature. Each side can be rolled back independently; adaptation is available only
when both sides support it.

The below-21-FPS rule is a browser-only policy change. A Pi that already supports
these adaptive profiles does not require an update for the new threshold or for
skipping directly from 720p60 to 540p30.
