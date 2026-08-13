import { describe, expect, it, vi } from "vitest";

import { RideSessionClient, type StoredDriveSession } from "./ride-session-client";

const session: StoredDriveSession = {
  sessionId: "bd450fe7-ec99-4983-a5fe-46ca30f260de",
  ticket: "signed-ticket",
  gatewayUrl: "wss://rcmania.live/gateway/v1/socket",
  expiresAt: "2026-08-13T10:05:00.000Z",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function harness() {
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
    addTransceiver: vi.fn(),
    createDataChannel: vi.fn((name: string) => name === "control-fast" ? fast : reliable),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    close: vi.fn()
  };
  const client = new RideSessionClient(session, {
    createSocket: () => socket as unknown as WebSocket,
    createPeer: () => peer as unknown as RTCPeerConnection
  });
  return { client, socket, peer, fast, reliable };
}

describe("RideSessionClient", () => {
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
});
