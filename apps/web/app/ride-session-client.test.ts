import { afterEach, describe, expect, it, vi } from "vitest";

import { RideSessionClient, type StoredDriveSession } from "./ride-session-client";

const session: StoredDriveSession = {
  sessionId: "bd450fe7-ec99-4983-a5fe-46ca30f260de",
  ticket: "signed-ticket",
  gatewayUrl: "wss://rcmania.live/gateway/v1/socket",
  expiresAt: "2026-08-13T10:05:00.000Z",
  steeringTrimPercent: 0,
  controlProtocolVersion: 4,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceTransportPolicy: "all"
};

const clients: RideSessionClient[] = [];

function harness(candidateType: "host" | "relay" | null = "host") {
  const socket = {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null as null | (() => void),
    onmessage: null as null | ((event: { data: string }) => void),
    onclose: null as null | (() => void),
    onerror: null as null | (() => void)
  };
  const fast = { readyState: "open", send: vi.fn(), close: vi.fn() };
  const reliable = { readyState: "open", send: vi.fn(), close: vi.fn() };
  const peer = {
    localDescription: { type: "offer", sdp: "v=0 offer" },
    connectionState: "new",
    iceConnectionState: "new",
    onicecandidate: null as null | ((event: { candidate: null | { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }) => void),
    ontrack: null as null | ((event: { streams: MediaStream[] }) => void),
    onconnectionstatechange: null as null | (() => void),
    ondatachannel: null as null | ((event: { channel: RTCDataChannel }) => void),
    addTransceiver: vi.fn(),
    createDataChannel: vi.fn((name: string) => name === "control-fast" ? fast : reliable),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    getStats: vi.fn(async () => candidateType === null ? new Map() : new Map([
      ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
      ["pair", { type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "local", remoteCandidateId: "remote" }],
      ["local", { type: "local-candidate", candidateType }],
      ["remote", { type: "remote-candidate", candidateType: "srflx" }]
    ])),
    close: vi.fn()
  };
  const createPeer = vi.fn(() => peer as unknown as RTCPeerConnection);
  const client = new RideSessionClient(session, {
    createSocket: () => socket as unknown as WebSocket,
    createPeer
  });
  clients.push(client);
  return { client, socket, peer, fast, reliable, createPeer };
}

describe("RideSessionClient", () => {
  afterEach(() => {
    clients.splice(0).forEach((client) => client.close());
    vi.useRealTimers();
  });

  it("reports decoded video measurements and requests a lower profile only on the dedicated supported channel", async () => {
    vi.useFakeTimers();
    const { client, peer, fast, reliable } = harness();
    const onVideoStats = vi.fn();
    client.onVideoStats = onVideoStats;
    let seconds = 0;
    peer.getStats.mockImplementation(async () => new Map([
      ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
      ["pair", { id: "pair", type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.4 }],
      ["video", { id: "video", type: "inbound-rtp", kind: "video", timestamp: ++seconds * 1000, frameWidth: 1280, frameHeight: 720, framesDecoded: seconds * 29, packetsReceived: seconds * 100, packetsLost: seconds * 10, jitter: 0.07 }],
    ]) as never);
    client.connect();
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(6000);
    expect(onVideoStats).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1280, height: 720, fps: 29 }));
    expect(fast.send).not.toHaveBeenCalled();
    expect(reliable.send).not.toHaveBeenCalled();

    const quality = { label: "video-quality", readyState: "open", bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: { data: string }) => void), onclose: null as null | (() => void) };
    peer.ondatachannel?.({ channel: quality as unknown as RTCDataChannel });
    quality.onmessage?.({ data: JSON.stringify({ v: 1, type: "video.capabilities", sessionId: "wrong-session", profiles: ["720p60", "360p30"], profile: "720p60" }) });
    await vi.advanceTimersByTimeAsync(6000);
    expect(quality.send).not.toHaveBeenCalled();
    quality.onmessage?.({ data: JSON.stringify({ v: 1, type: "video.capabilities", sessionId: session.sessionId, profiles: ["720p60", "720p30", "540p30", "360p30"], profile: "720p60" }) });
    await vi.advanceTimersByTimeAsync(12000);
    expect(quality.send).toHaveBeenCalledWith(JSON.stringify({ v: 1, type: "video.profile.request", sessionId: session.sessionId, profile: "720p30" }));
    expect(reliable.send).not.toHaveBeenCalled();
    client.close();
    const callCount = peer.getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(peer.getStats).toHaveBeenCalledTimes(callCount);
    expect(quality.close).toHaveBeenCalledOnce();
    expect(onVideoStats).toHaveBeenLastCalledWith(null);
  });

  it("ignores a late stats response after session closure", async () => {
    vi.useFakeTimers();
    const { client, peer } = harness();
    const onVideoStats = vi.fn();
    client.onVideoStats = onVideoStats;
    let complete: ((value: never) => void) | undefined;
    peer.getStats.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    client.connect();
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(1000);
    client.close();
    onVideoStats.mockClear();
    complete?.(new Map() as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onVideoStats).not.toHaveBeenCalled();
  });
  it("authenticates first, creates receive-video offer, and uses safe channel modes", async () => {
    const { client, socket, peer } = harness();
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({ v: 1, type: "browser.authenticate", ticket: session.ticket }));
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "session.start", sessionId: session.sessionId, carId: "566a5cd4-4cd6-4cc5-855e-36bc54c1ae4a", expiresAt: session.expiresAt, iceServers: session.iceServers }) });
    await vi.waitFor(() => expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ v: 1, type: "signal.offer", sessionId: session.sessionId, sdp: "v=0 offer" })));

    expect(peer.addTransceiver).toHaveBeenCalledWith("video", { direction: "recvonly" });
    expect(peer.createDataChannel).toHaveBeenCalledWith("control-fast", { ordered: false, maxRetransmits: 0 });
    expect(peer.createDataChannel).toHaveBeenCalledWith("control-reliable", { ordered: true });
  });

  it("applies the answer, remote ICE, and publishes the real remote video stream", async () => {
    const { client, socket, peer } = harness();
    const onStream = vi.fn();
    client.onStream = onStream;
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "signal.answer", sessionId: session.sessionId, sdp: "v=0 answer" }) });
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "signal.ice", sessionId: session.sessionId, candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 }) });
    const stream = {} as MediaStream;
    peer.ontrack?.({ streams: [stream] });
    await vi.waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled());

    expect(peer.addIceCandidate).toHaveBeenCalledWith({ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 });
    expect(onStream).toHaveBeenCalledWith(stream);
  });

  it("publishes numeric battery telemetry for its authenticated session", () => {
    const { client, socket } = harness();
    const onTelemetry = vi.fn();
    client.onTelemetry = onTelemetry;
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    socket.onmessage?.({ data: JSON.stringify({
      v: 1,
      type: "device.telemetry",
      sessionId: session.sessionId,
      batteryVoltage: 12.6,
      batteryPercent: 84,
    }) });

    expect(onTelemetry).toHaveBeenCalledOnce();
    expect(onTelemetry).toHaveBeenCalledWith({ batteryVoltage: 12.6, batteryPercent: 84 });
  });

  it("publishes unavailable battery values as null", () => {
    const { client, socket } = harness();
    const onTelemetry = vi.fn();
    client.onTelemetry = onTelemetry;
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    socket.onmessage?.({ data: JSON.stringify({
      v: 1,
      type: "device.telemetry",
      sessionId: session.sessionId,
      batteryVoltage: null,
      batteryPercent: null,
    }) });

    expect(onTelemetry).toHaveBeenCalledOnce();
    expect(onTelemetry).toHaveBeenCalledWith({ batteryVoltage: null, batteryPercent: null });
  });

  it("rejects telemetry for a different session without publishing it", () => {
    const { client, socket } = harness();
    const onTelemetry = vi.fn();
    const onError = vi.fn();
    client.onTelemetry = onTelemetry;
    client.onError = onError;
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    socket.onmessage?.({ data: JSON.stringify({
      v: 1,
      type: "device.telemetry",
      sessionId: "566a5cd4-4cd6-4cc5-855e-36bc54c1ae4a",
      batteryVoltage: 12.6,
      batteryPercent: 84,
    }) });

    expect(onError).toHaveBeenCalledWith("Unexpected session");
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  it("reports real gateway, signaling, peer, and video milestones", async () => {
    const { client, socket, peer } = harness();
    const progress: string[] = [];
    client.onProgress = (event) => progress.push(event);

    client.connect();
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "session.start", sessionId: session.sessionId, carId: "566a5cd4-4cd6-4cc5-855e-36bc54c1ae4a", expiresAt: session.expiresAt, iceServers: session.iceServers }) });
    await vi.waitFor(() => expect(progress).toContain("webrtc.offer-sent"));

    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: "signal.answer", sessionId: session.sessionId, sdp: "v=0 answer" }) });
    await vi.waitFor(() => expect(progress).toContain("webrtc.answer-applied"));
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    await vi.waitFor(() => expect(progress).toContain("webrtc.direct"));
    peer.ontrack?.({ streams: [{} as MediaStream] });

    expect(progress).toEqual([
      "gateway.connecting",
      "gateway.connected",
      "session.started",
      "webrtc.offer-sent",
      "webrtc.answer-applied",
      "webrtc.direct",
      "video.track-received",
    ]);
  });

  it("confirms an active drive exactly once after WebRTC connects", async () => {
    const { client, socket, peer } = harness();
    client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    peer.onconnectionstatechange?.();

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      v: 1,
      type: "session.connected",
      sessionId: session.sessionId,
    })));
    expect(socket.send.mock.calls.filter(([payload]) => String(payload).includes('"session.connected"'))).toHaveLength(1);
  });

  it("reports TURN when the selected candidate pair contains a relay", async () => {
    const { client, peer } = harness("relay");
    const states: string[] = [];
    const progress: string[] = [];
    client.onState = (state) => states.push(state);
    client.onProgress = (event) => progress.push(event);
    client.connect();

    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();

    await vi.waitFor(() => expect(states).toContain("TURN"));
    expect(progress).toContain("webrtc.turn");
    expect(progress).not.toContain("webrtc.direct");
  });

  it("reports CONNECTED instead of claiming direct when candidate stats are unavailable", async () => {
    const { client, peer } = harness(null);
    const states: string[] = [];
    client.onState = (state) => states.push(state);
    client.connect();

    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();

    await vi.waitFor(() => expect(states).toContain("CONNECTED"));
    expect(states).not.toContain("DIRECT");
  });

  it("ends and closes every transport", () => {
    const { client, socket, peer, fast, reliable } = harness();
    client.connect();
    socket.readyState = 1;

    client.close("operator ended");

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ v: 1, type: "session.end", sessionId: session.sessionId, reason: "operator ended" }));
    expect(fast.close).toHaveBeenCalled();
    expect(reliable.close).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
  });

  it("can force relay policy for a controlled TURN acceptance test", () => {
    const relaySession = { ...session, iceTransportPolicy: "relay" as const };
    const { socket, peer, createPeer } = harness();
    const client = new RideSessionClient(relaySession, {
      createSocket: () => socket as unknown as WebSocket,
      createPeer
    });

    client.connect();

    expect(createPeer).toHaveBeenCalledWith(expect.objectContaining({ iceTransportPolicy: "relay" }));
    peer.close();
  });
});
