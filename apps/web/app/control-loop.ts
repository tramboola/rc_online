export interface DriveCommand {
  readonly rideId: string;
  readonly sequence: number;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
  readonly receivedMonotonicMs: number;
}

export class BrowserControlLoop {
  readonly #rideId: string;
  #fastChannel: RTCDataChannel | null = null;
  #reliableChannel: RTCDataChannel | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #sequence = 0;
  #steering = 0;
  #throttle = 0;
  #brake = 0;

  public constructor(rideId: string) {
    this.#rideId = rideId;
  }

  public bindChannels(
    fastChannel: RTCDataChannel,
    reliableChannel: RTCDataChannel,
  ): void {
    this.#fastChannel = fastChannel;
    this.#reliableChannel = reliableChannel;
  }

  public setInput(input: {
    steering?: number;
    throttle?: number;
    brake?: number;
  }): void {
    this.#steering = input.steering ?? this.#steering;
    this.#throttle = input.throttle ?? this.#throttle;
    this.#brake = input.brake ?? this.#brake;
  }

  public start(): void {
    if (this.#timer) {
      return;
    }
    this.#timer = setInterval(() => this.sendLatest(), 20);
  }

  public neutral(reason: string): void {
    this.#steering = 0;
    this.#throttle = 0;
    this.#brake = 1000;
    const message = JSON.stringify({ type: "neutral", reason, rideId: this.#rideId });
    if (this.#reliableChannel?.readyState === "open") {
      this.#reliableChannel.send(message);
    }
    this.sendLatest();
  }

  public stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.neutral("control_loop_stopped");
  }

  private sendLatest(): void {
    const command: DriveCommand = {
      rideId: this.#rideId,
      sequence: ++this.#sequence,
      steering: this.#steering,
      throttle: this.#throttle,
      brake: this.#brake,
      receivedMonotonicMs: Math.round(performance.now()),
    };
    if (this.#fastChannel?.readyState === "open") {
      this.#fastChannel.send(JSON.stringify(command));
      return;
    }
    const edgeOrigin =
      process.env.NEXT_PUBLIC_EDGE_ORIGIN ??
      (process.env.NODE_ENV === "development" ? "http://localhost:3002" : null);
    if (!edgeOrigin) {
      return;
    }
    void fetch(`${edgeOrigin}/v1/edge/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function createRidePeerConnection(
  iceServers: RTCIceServer[],
): {
  peer: RTCPeerConnection;
  fast: RTCDataChannel;
  reliable: RTCDataChannel;
} {
  const peer = new RTCPeerConnection({ iceServers });
  const fast = peer.createDataChannel("control-fast", {
    ordered: false,
    maxRetransmits: 0,
  });
  const reliable = peer.createDataChannel("control-reliable", {
    ordered: true,
  });
  return { peer, fast, reliable };
}
