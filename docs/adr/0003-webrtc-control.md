# ADR 0003: WebRTC media and dual control channels

Status: accepted, 2026-07-25.

Browser and Pi negotiate video/audio and two DataChannels. `control-fast` is
unordered, has no retransmit backlog, and carries only the newest approximately
50 Hz command. `control-reliable` carries discrete actions and acknowledgements.
Blur, page hide, disconnect, stale input, ride mismatch, and operator stop
produce neutral. Cloud signaling is reconnectable and instance-independent.
