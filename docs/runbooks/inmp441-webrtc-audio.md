# Onboard microphone audio

The driving browser receives video and optional microphone audio through the same
WebRTC peer connection, including when ICE selects TURN. The gateway forwards SDP
and ICE unchanged; no media server or database migration is required.

The browser requests receive-only video and audio. A car without microphone support
can still answer with video only. Audio and video tracks are combined into one media
stream; an audio track alone must not mark the camera ready or arm controls.

Playback starts with sound enabled. If browser autoplay policy blocks sound, keep
video running muted and offer an enable-sound button. A subsequent pointer/keyboard
gesture retries audio. An intentional mute stays muted. Volume controls must not
send keyboard driving commands.

## First car: Raspberry Pi 4, INMP441

Hardware capture was verified at 48 kHz, stereo S32_LE: left channel carries audio,
right channel is unused because the module's L/R pin is grounded. The agent selects
the left channel, converts to mono PCM, and sends Opus. Capture runs only while a
negotiated audio session exists. Initial capture settling is muted; capture failure
must not prevent camera/control startup or cleanup.

The tested persistent boot overlay is:

```ini
[all]
dtoverlay=adau7002-simple,card-name=INMP441
```

The first car has this service drop-in at
`/etc/systemd/system/rc-pi-agent.service.d/30-inmp441.conf`:

```ini
[Service]
SupplementaryGroups=audio
Environment=RC_AUDIO_ENABLED=1
Environment=RC_AUDIO_DEVICE=hw:CARD=INMP441,DEV=0
Environment=RC_AUDIO_GAIN=64
```

Gain 64 was selected from the confirmed voice/clap recording on this module;
adjust it if loud engine noise clips. Other cars remain audio-disabled by default.
Steering uses BCM12 / physical pin32; ESC uses BCM13 / physical pin33. I2S uses
BCM18/19/20 / physical pins12/35/38. Keep these numbering systems distinct.

For overlay-root installations, save the service drop-in in both the persistent
lower filesystem and the active view. Save the boot overlay on the boot partition.
Check both VFS and filesystem read-only flags afterward. A zipapp OTA update alone
does not install these operating-system settings or `arecord`.

## Verification

Run the browser session-client, playback, and audio-control regressions, plus the
existing connection/keyboard/control suites and TypeScript/build checks. The Pi
suite should exercise real aiortc audio/video negotiation, legacy video-only offers,
missing devices, PCM conversion, and capture-process cleanup.

After deployment, join the first car through the normal UI without sending motion.
Verify live video and audio tracks, unmuted playback, mute/unmute, and normal session
closure. Check that `arecord` exits after the session and the car returns AVAILABLE.
Do not use a healthy OTA marker alone as evidence that microphone audio works.
