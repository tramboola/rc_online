# Low-bandwidth onboard video — local preparation, 2026-09-22

Uncommitted changes based on web `a6b1243` and Pi Agent `700510d` (0.8.1).
No commit, push, publication, VPS update, Pi connection or live control command
was performed for this change. The original dirty RC checkout was not modified.

## Shared hardware profiles

| Profile | Encoded dimensions | Target FPS | Encoder ceiling | Downgrade budget |
| --- | --- | --- | --- | --- |
| 720p30 | 1280 × 720 | 30 | 2,000 kbit/s | below 1,400 kbit/s |
| 540p30 | 960 × 540 | 30 | 1,400 kbit/s | below 800 kbit/s |
| 360p30 | 640 × 360 | 30 | 800 kbit/s | below 500 kbit/s |
| 240p30 | 426 × 240 | 30 | 500 kbit/s | minimum profile |

Ceilings are additionally limited by the configured encoder maximum. Receiver
feedback may reduce encoding bitrate to 250 kbit/s. Physical acceptance of
426×240 and the lower bitrate floor must be checked on both boards before a
production rollout is declared successful. Local tests use simulated hardware.

The same Picamera2/V4L2 H.264 path serves Pi 4 and Zero 2 W, without software
re-encoding. Camera reconfiguration runs off the control event loop, serialized
with feedback and shutdown. The four-frame / 150-ms source queue bound and
keyframe recovery remain unchanged; this does not bound network/browser delay.
The browser still understands legacy 720p60 when an older software agent offers
it; the shared hardware agent does not advertise that profile.

## Earlier resolution changes

The Pi forwards the latest **raw receiver REMB bandwidth estimate**, not its
capped encoder target and not received bytes per second. Every 500 ms, the
optional ordered `video-quality` channel carries the estimate and its source
age. It also sends a sample on opening. One timer is cancelled on close, and
backpressure drops optional telemetry rather than building an unbounded queue.

- Below the current profile's budget for one second: request a supported lower
  profile suitable for that budget, skipping intermediate profiles when needed.
- A collapse below 650 kbit/s that skips more than one step: request after 500 ms.
- A recovered estimate, unknown/stale sample (>1.5 seconds), or long telemetry
  gap resets bandwidth evidence. It is not treated as proof of a good link.
- Existing receiver statistics are sampled about once a second. After the
  initial three-second warmup, three impaired samples still lower the profile.
  Impairment thresholds remain FPS <21, RTT >250 ms, jitter >50 ms, loss >5%,
  buffer residence >150 ms, or stalled decoding. Low FPS lowers resolution.
- Once bandwidth telemetry is present, the old eight-second browser cooldown
  no longer blocks further downgrades. Pi downgrades also bypass its two-second
  cooldown but remain single-flight, with only the latest pending request.
- Upgrade one step only after six continuous seconds of healthy measurements
  **and** a fresh bandwidth estimate at least 25% above the next profile's
  minimum: 625 kbit/s to 360p, 1 Mbit/s to 540p, 1.75 Mbit/s to 720p30.
  Healthy means FPS ≥21, RTT <160 ms, jitter <25 ms, loss <1%, and available
  buffer residence <80 ms. Pi retains its two-second upgrade cooldown.

Only the browser chooses resolution; the Pi applies encoder bitrate feedback
and requested profiles. Profile requests are serial, with a five-second ACK
window and at most three unanswered attempts. A late ACK for the latest request
still resynchronizes policy after that window or the retry cap. Unrelated ACKs
cannot rewrite the current profile.

Conservative limitation: a low-bandwidth estimate from a static, low-traffic
scene may not reveal unused link capacity. Without sufficient measured headroom,
quality stays lower even with good FPS. After a new agent has emitted bandwidth
telemetry, missing REMB prevents upgrades; no bandwidth is invented. Older
agents that send no telemetry retain the prior statistics-only policy/cooldown.

## Optional protocol

Capability keys remain unchanged; only the supported profile list expands:

```json
{"v":1,"type":"video.capabilities","sessionId":"<session>","profiles":["720p30","540p30","360p30","240p30"],"profile":"720p30"}
{"v":1,"type":"video.bandwidth","sessionId":"<session>","estimatedBitrateBps":750000,"sampleAgeMs":100}
```

Before an estimate exists both `estimatedBitrateBps` and `sampleAgeMs` are null.
Messages are session-scoped and strictly checked. The existing request/applied
messages are unchanged. Hidden/disconnected clients do not request profile
changes; closing the session cancels polling. No database or gateway change.

## Playback and control safety

240p uses the same measured-resolution/FPS text, e.g. `426×240 · 30 FPS`, with
no special colour, emergency badge or warning. Measured FPS is not replaced by
the target 30. The existing display fallback for unknown measurements remains.

Where the browser exposes it, both receiving audio and video request
`jitterBufferTarget = 0`. This is an optional preference, not guaranteed zero
buffering or end-to-end latency; unsupported setters are ignored. See the
[W3C receiver buffering API](https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-jitterbuffertarget).
`contentHint` on a receiving track cannot configure the remote hardware encoder;
it is not substituted for the Pi feedback path. See
[MediaStreamTrack Content Hints](https://www.w3.org/TR/mst-content-hint/).

Controls require a presented video frame at startup. No fresh frame for one
second clears keyboard/touch input and disarms. Once video recovers, the user
must explicitly tap RESUME CONTROLS; focus, a held key and new frames cannot
re-arm it. Hidden/paused playback requires a fresh visible frame and manual
resume. Frame callbacks are preferred, with decoded/displayed counters or media
time as browser fallbacks. This detects stopped local video, **not** a progressing
but delayed camera stream. Existing 200-ms command watchdog and unreliable,
unordered fast-control channel remain unchanged.

## Verification and staged rollout

Automated tests cover bandwidth hysteresis, stale feedback, late ACK recovery,
protocol validation, unchanged labels, startup/freeze/manual-resume lifecycle,
both control inputs, and real local WebRTC decoding with a simulated encoder.

Fresh final verification: **677 web tests passed**, 17 opt-in PostgreSQL tests
skipped because disposable test databases were not configured. Web TypeScript,
Next.js production build and standalone preparation passed. Pi suite: **321
passed on aiortc 1.14.0 and 321 on 1.15.0**. Both worktrees pass `git diff --check`.
One intermediate Pi repeat stalled in an existing audio loopback test; after
interrupting that run, full reruns passed. No physical camera tests were run.

Deployment is deliberately deferred. Deploy web first and reload existing drive
tabs before installing the new Pi artifact: older browser code rejects a profile
list containing unknown 240p. The new web works with the existing three-profile
agent. No TURN configuration, Wi-Fi, GPIO, white balance or overlayroot change.

Then validate one idle secured car and the other model, using the same signed
artifact: hardware 426×240/250 kbit/s acceptance, profile transitions, actual
iPhone/desktop playback, packet loss, recovery, video pause/manual resume,
unchanged command watchdog, direct/relay paths and real glass-to-glass latency.
Keep the existing 0.8.1 artifact for rollback and verify overlayroot after rollout.
