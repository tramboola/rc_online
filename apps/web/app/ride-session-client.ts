import { GatewayServerMessageSchema, type IceServer } from "@rc/contracts";

export type StoredDriveSession = {
  sessionId: string;
  ticket: string;
  gatewayUrl: string;
  expiresAt: string;
  iceServers: IceServer[];
};

type RideSessionClientDependencies = {
  createSocket(url: string): WebSocket;
  createPeer(configuration: RTCConfiguration): RTCPeerConnection;
};

const defaultDependencies: RideSessionClientDependencies = {
  createSocket: (url) => new WebSocket(url),
  createPeer: (configuration) => new RTCPeerConnection(configuration)
};

export class RideSessionClient {
  readonly #session: StoredDriveSession;
  readonly #dependencies: RideSessionClientDependencies;
  #socket: WebSocket | null = null;
  #peer: RTCPeerConnection | null = null;
  #fast: RTCDataChannel | null = null;
  #reliable: RTCDataChannel | null = null;
  #closed = false;

  onStream: (stream: MediaStream) => void = () => undefined;
  onState: (state: "CONNECTING" | "DIRECT" | "DISCONNECTED") => void = () => undefined;
  onError: (message: string) => void = () => undefined;

  constructor(session: StoredDriveSession, dependencies: RideSessionClientDependencies = defaultDependencies) {
    this.#session = session;
    this.#dependencies = dependencies;
  }

  get channels(): { fast: RTCDataChannel; reliable: RTCDataChannel } | null {
    return this.#fast && this.#reliable ? { fast: this.#fast, reliable: this.#reliable } : null;
  }

  connect(): void {
    if (this.#socket || this.#closed) return;
    this.onState("CONNECTING");
    const iceServers: RTCIceServer[] = this.#session.iceServers.map((server) => ({
      urls: server.urls,
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined ? {} : { credential: server.credential })
    }));
    const peer = this.#dependencies.createPeer({ iceServers });
    this.#peer = peer;
    peer.addTransceiver("video", { direction: "recvonly" });
    this.#fast = peer.createDataChannel("control-fast", { ordered: false, maxRetransmits: 0 });
    this.#reliable = peer.createDataChannel("control-reliable", { ordered: true });
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) this.onStream(stream);
    };
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.#send({
        v: 1,
        type: "signal.ice",
        sessionId: this.#session.sessionId,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex
      });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") this.onState("DIRECT");
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) this.onState("DISCONNECTED");
    };

    const socket = this.#dependencies.createSocket(this.#session.gatewayUrl);
    this.#socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "browser.authenticate", ticket: this.#session.ticket }));
    socket.onmessage = (event) => void this.#handleMessage(String(event.data));
    socket.onerror = () => this.onError("Gateway connection failed");
    socket.onclose = () => this.onState("DISCONNECTED");
  }

  close(reason = "browser closed session"): void {
    if (this.#closed) return;
    this.#send({ v: 1, type: "session.end", sessionId: this.#session.sessionId, reason });
    this.#closed = true;
    this.#fast?.close();
    this.#reliable?.close();
    this.#peer?.close();
    this.#socket?.close();
    this.onState("DISCONNECTED");
  }

  async #handleMessage(raw: string): Promise<void> {
    try {
      const message = GatewayServerMessageSchema.parse(JSON.parse(raw));
      if (message.type === "auth.rejected" || message.type === "error") {
        this.onError(message.type === "error" ? message.message : message.reason);
        return;
      }
      if (message.type === "session.start") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        const offer = await this.#peer?.createOffer();
        if (!offer || !this.#peer) throw new Error("Could not create WebRTC offer");
        await this.#peer.setLocalDescription(offer);
        const sdp = this.#peer.localDescription?.sdp;
        if (!sdp) throw new Error("WebRTC offer has no SDP");
        this.#send({ v: 1, type: "signal.offer", sessionId: this.#session.sessionId, sdp });
        return;
      }
      if (message.type === "signal.answer") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        await this.#peer?.setRemoteDescription({ type: "answer", sdp: message.sdp });
        return;
      }
      if (message.type === "signal.ice") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        await this.#peer?.addIceCandidate(message.candidate === null ? null : {
          candidate: message.candidate,
          sdpMid: message.sdpMid,
          sdpMLineIndex: message.sdpMLineIndex
        });
        return;
      }
      if (message.type === "session.end") this.close(message.reason);
    } catch (error) {
      this.onError(error instanceof Error ? error.message : "Invalid gateway message");
    }
  }

  #send(message: object): void {
    if (this.#socket?.readyState === 1) this.#socket.send(JSON.stringify(message));
  }
}

export async function createAdminDriveSession(carId: string): Promise<StoredDriveSession> {
  const response = await fetch("/api/admin/drive-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ carId })
  });
  if (!response.ok) throw new Error(response.status === 409 ? "The selected car is no longer available" : "Could not create a drive session");
  return response.json() as Promise<StoredDriveSession>;
}

const storageKey = "rcmania.pending-drive-session";

export function saveDriveSession(session: StoredDriveSession): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session));
}

export function loadDriveSession(): StoredDriveSession | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  sessionStorage.removeItem(storageKey);
  try {
    const parsed = JSON.parse(raw) as StoredDriveSession;
    return parsed.sessionId && parsed.ticket && parsed.gatewayUrl ? parsed : null;
  } catch {
    return null;
  }
}
