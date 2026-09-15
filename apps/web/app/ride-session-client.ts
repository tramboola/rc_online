import { GatewayServerMessageSchema, type IceServer } from "@rc/contracts";
import { AdaptiveVideoPolicy, VideoStatsSampler, type VideoProfile, type VideoStreamStats } from "./adaptive-video";

const videoProfiles: readonly VideoProfile[] = ["720p60", "720p30", "540p30", "360p30"];

export type StoredDriveSession = {
  sessionId: string;
  ticket: string;
  gatewayUrl: string;
  expiresAt: string;
  steeringTrimPercent: number;
  controlProtocolVersion: 3 | 4 | 5;
  iceServers: IceServer[];
  iceTransportPolicy: "all" | "relay";
};

export type RideConnectionProgress =
  | "gateway.connecting"
  | "gateway.connected"
  | "session.started"
  | "webrtc.offer-sent"
  | "webrtc.answer-applied"
  | "webrtc.direct"
  | "webrtc.turn"
  | "webrtc.connected"
  | "video.track-received";

export type RideConnectionState = "CONNECTING" | "DIRECT" | "TURN" | "CONNECTED" | "DISCONNECTED";

export type RideBatteryTelemetry = {
  batteryVoltage: number | null;
  batteryPercent: number | null;
};

type RideSessionClientDependencies = {
  createSocket(url: string): WebSocket;
  createPeer(configuration: RTCConfiguration): RTCPeerConnection;
  createStream?(): MediaStream;
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
  #remoteStream: MediaStream | null = null;
  #fast: RTCDataChannel | null = null;
  #reliable: RTCDataChannel | null = null;
  #closed = false;
  #connectedReported = false;
  #videoQuality: RTCDataChannel | null = null;
  #videoPolicy: AdaptiveVideoPolicy | null = null;
  #supportedProfiles: readonly VideoProfile[] = [];
  #requestedProfile: VideoProfile | null = null;
  #videoSampler = new VideoStatsSampler();
  #statsTimer: ReturnType<typeof setTimeout> | null = null;
  #statsGeneration = 0;
  #statsRunning = false;

  onStream: (stream: MediaStream) => void = () => undefined;
  onState: (state: RideConnectionState) => void = () => undefined;
  onError: (message: string) => void = () => undefined;
  onProgress: (event: RideConnectionProgress) => void = () => undefined;
  onTelemetry: (telemetry: RideBatteryTelemetry) => void = () => undefined;
  onVideoStats: (stats: VideoStreamStats | null) => void = () => undefined;

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
    this.onProgress("gateway.connecting");
    const iceServers: RTCIceServer[] = this.#session.iceServers.map((server) => ({
      urls: server.urls,
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined ? {} : { credential: server.credential })
    }));
    const peer = this.#dependencies.createPeer({
      iceServers,
      iceTransportPolicy: this.#session.iceTransportPolicy ?? "all"
    });
    this.#peer = peer;
    const stream = this.#dependencies.createStream?.() ?? new MediaStream();
    this.#remoteStream = stream;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    this.#fast = peer.createDataChannel("control-fast", { ordered: false, maxRetransmits: 0 });
    this.#reliable = peer.createDataChannel("control-reliable", { ordered: true });
    // Only upgraded agents create this channel. Older agents keep their existing
    // control protocol and can still provide receive-side video measurements.
    peer.ondatachannel = (event) => this.#bindVideoQuality(event.channel);
    peer.ontrack = (event) => {
      if (this.#closed) return;
      const track = event.track;
      if (!stream.getTracks().includes(track)) {
        stream.addTrack(track);
        track.addEventListener("ended", () => {
          stream.removeTrack(track);
          if (!this.#closed && stream.getVideoTracks().length > 0) this.onStream(stream);
        });
      }
      if (track.kind === "video") this.onProgress("video.track-received");
      // Audio may arrive first or in its own stream. Publish a stable combined
      // stream only once video exists, so audio alone cannot arm the drive.
      if (stream.getVideoTracks().length > 0) this.onStream(stream);
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
      if (peer.connectionState === "connected") {
        if (!this.#connectedReported) {
          this.#connectedReported = true;
          this.#send({ v: 1, type: "session.connected", sessionId: this.#session.sessionId });
        }
        void this.#reportConnectedRoute(peer);
        this.#startVideoStats(peer);
      }
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        this.#stopVideoStats();
        this.onState("DISCONNECTED");
      }
    };

    const socket = this.#dependencies.createSocket(this.#session.gatewayUrl);
    this.#socket = socket;
    socket.onopen = () => {
      this.onProgress("gateway.connected");
      socket.send(JSON.stringify({ v: 1, type: "browser.authenticate", ticket: this.#session.ticket }));
    };
    socket.onmessage = (event) => void this.#handleMessage(String(event.data));
    socket.onerror = () => this.onError("Gateway connection failed");
    socket.onclose = () => this.onState("DISCONNECTED");
  }

  async #reportConnectedRoute(peer: RTCPeerConnection): Promise<void> {
    const route = await detectConnectionRoute(peer);
    if (this.#closed || peer.connectionState !== "connected") return;
    this.onProgress(route === "DIRECT"
      ? "webrtc.direct"
      : route === "TURN"
        ? "webrtc.turn"
        : "webrtc.connected");
    this.onState(route);
  }

  close(reason = "browser closed session"): void {
    if (this.#closed) return;
    this.#send({ v: 1, type: "session.end", sessionId: this.#session.sessionId, reason });
    this.#closed = true;
    this.#stopVideoStats();
    if (this.#videoQuality) {
      this.#videoQuality.onmessage = null;
      this.#videoQuality.onclose = null;
      this.#videoQuality.close();
      this.#videoQuality = null;
    }
    this.#fast?.close();
    this.#reliable?.close();
    this.#peer?.close();
    this.#remoteStream?.getTracks().forEach((track) => track.stop());
    this.#remoteStream = null;
    this.#socket?.close();
    this.onState("DISCONNECTED");
  }

  #bindVideoQuality(channel: RTCDataChannel): void {
    if (this.#closed || channel.label !== "video-quality" || this.#videoQuality) return;
    this.#videoQuality = channel;
    channel.onclose = () => {
      if (this.#videoQuality !== channel) return;
      this.#videoQuality = null;
      this.#videoPolicy = null;
      this.#supportedProfiles = [];
      this.#requestedProfile = null;
    };
    channel.onmessage = (event) => {
      if (this.#closed || channel !== this.#videoQuality || typeof event.data !== "string" || event.data.length > 2048) return;
      try {
        const message = JSON.parse(event.data);
        if (!message || message.v !== 1 || message.sessionId !== this.#session.sessionId) return;
        if (message.type === "video.capabilities" && !this.#videoPolicy) {
          if (Object.keys(message).sort().join() !== "profile,profiles,sessionId,type,v") return;
          if (!Array.isArray(message.profiles) || message.profiles.length < 1 || message.profiles.length > 4) return;
          const profiles = videoProfiles.filter((profile) => message.profiles.includes(profile));
          if (profiles.length !== message.profiles.length || !profiles.includes(message.profile)) return;
          this.#supportedProfiles = profiles;
          this.#videoPolicy = new AdaptiveVideoPolicy(profiles, message.profile);
        } else if (message.type === "video.profile.applied") {
          if (Object.keys(message).sort().join() !== "profile,sessionId,type,v") return;
          if (message.profile !== this.#requestedProfile || !this.#supportedProfiles.includes(message.profile)) return;
          this.#videoPolicy?.acknowledge(message.profile, performance.now());
          this.#requestedProfile = null;
        }
      } catch {
        // Optional video negotiation must never interrupt the driving session.
      }
    };
  }

  #startVideoStats(peer: RTCPeerConnection): void {
    if (this.#closed || this.#statsRunning) return;
    this.#statsRunning = true;
    const generation = ++this.#statsGeneration;
    const current = () => !this.#closed && generation === this.#statsGeneration && peer.connectionState === "connected";
    const sample = async () => {
      try {
        const report = await peer.getStats();
        if (!current()) return;
        const stats = this.#videoSampler.sample(report);
        this.onVideoStats(stats);
        const quality = this.#videoQuality;
        const visible = typeof document === "undefined" || document.visibilityState === "visible";
        if (visible && quality?.readyState === "open" && quality.bufferedAmount < 2048) {
          const profile = this.#videoPolicy?.observe(stats, performance.now());
          if (profile) {
            this.#requestedProfile = profile;
            quality.send(JSON.stringify({ v: 1, type: "video.profile.request", sessionId: this.#session.sessionId, profile }));
          }
        }
      } catch {
        if (current()) {
          this.#videoSampler = new VideoStatsSampler();
          this.onVideoStats(null);
        }
      } finally {
        // Schedule after completion, so slow getStats never accumulates requests.
        if (current()) this.#statsTimer = setTimeout(() => void sample(), 1000);
      }
    };
    this.#statsTimer = setTimeout(() => void sample(), 1000);
  }

  #stopVideoStats(): void {
    this.#statsGeneration += 1;
    this.#statsRunning = false;
    if (this.#statsTimer !== null) clearTimeout(this.#statsTimer);
    this.#statsTimer = null;
    this.#videoSampler = new VideoStatsSampler();
    this.onVideoStats(null);
  }

  async #handleMessage(raw: string): Promise<void> {
    try {
      const message = GatewayServerMessageSchema.parse(JSON.parse(raw));
      if (message.type === "auth.rejected" || message.type === "error") {
        this.onError(message.type === "error" ? message.message : message.reason);
        return;
      }
      if (message.type === "device.telemetry") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        this.onTelemetry({
          batteryVoltage: message.batteryVoltage,
          batteryPercent: message.batteryPercent,
        });
        return;
      }
      if (message.type === "session.start") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        this.onProgress("session.started");
        const offer = await this.#peer?.createOffer();
        if (!offer || !this.#peer) throw new Error("Could not create WebRTC offer");
        await this.#peer.setLocalDescription(offer);
        const sdp = this.#peer.localDescription?.sdp;
        if (!sdp) throw new Error("WebRTC offer has no SDP");
        this.#send({ v: 1, type: "signal.offer", sessionId: this.#session.sessionId, sdp });
        this.onProgress("webrtc.offer-sent");
        return;
      }
      if (message.type === "signal.answer") {
        if (message.sessionId !== this.#session.sessionId) throw new Error("Unexpected session");
        await this.#peer?.setRemoteDescription({ type: "answer", sdp: message.sdp });
        this.onProgress("webrtc.answer-applied");
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

export async function detectConnectionRoute(
  peer: Pick<RTCPeerConnection, "getStats">
): Promise<"DIRECT" | "TURN" | "CONNECTED"> {
  try {
    const report = await peer.getStats();
    const stats = new Map<string, Record<string, unknown>>();
    for (const [key, entry] of report.entries()) {
      const value = entry as unknown as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id : key;
      stats.set(id, value);
    }
    let selectedPairId: string | undefined;
    for (const value of stats.values()) {
      if (value.type === "transport" && typeof value.selectedCandidatePairId === "string") {
        selectedPairId = value.selectedCandidatePairId;
        break;
      }
    }
    const pair = selectedPairId ? stats.get(selectedPairId) : [...stats.values()].find((value) => (
      value.type === "candidate-pair" &&
      value.state === "succeeded" &&
      (value.selected === true || value.nominated === true)
    ));
    if (!pair) return "CONNECTED";
    const local = typeof pair.localCandidateId === "string" ? stats.get(pair.localCandidateId) : undefined;
    const remote = typeof pair.remoteCandidateId === "string" ? stats.get(pair.remoteCandidateId) : undefined;
    const candidateTypes = [local?.candidateType, remote?.candidateType].filter((value): value is string => typeof value === "string");
    if (candidateTypes.includes("relay")) return "TURN";
    return candidateTypes.length > 0 ? "DIRECT" : "CONNECTED";
  } catch {
    return "CONNECTED";
  }
}

export async function createDriveSession(carId: string): Promise<StoredDriveSession> {
  const response = await fetch("/api/drive-sessions", {
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
    return (
      parsed.sessionId &&
      parsed.ticket &&
      parsed.gatewayUrl &&
      Number.isInteger(parsed.steeringTrimPercent) &&
      parsed.steeringTrimPercent >= -20 &&
      parsed.steeringTrimPercent <= 20 &&
      (parsed.controlProtocolVersion === 3 || parsed.controlProtocolVersion === 4 || parsed.controlProtocolVersion === 5)
    ) ? parsed : null;
  } catch {
    return null;
  }
}
