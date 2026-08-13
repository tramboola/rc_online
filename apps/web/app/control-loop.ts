export interface DriveCommand {
  readonly v: 1;
  readonly type: "control";
  readonly sessionId: string;
  readonly sequence: number;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
  readonly nitro: boolean;
  readonly armed: boolean;
}

export class BrowserControlLoop {
  readonly #sessionId: string;
  #fastChannel: RTCDataChannel | null = null;
  #reliableChannel: RTCDataChannel | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #sequence = 0;
  #steering = 0;
  #throttle = 0;
  #brake = 0;
  #nitro = false;
  #armed = false;

  public constructor(sessionId: string) {
    this.#sessionId = sessionId;
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
    nitro?: boolean;
  }): void {
    this.#steering = clamp(input.steering ?? this.#steering, -1000, 1000);
    this.#throttle = clamp(input.throttle ?? this.#throttle, -1000, 1000);
    this.#brake = clamp(input.brake ?? this.#brake, 0, 1000);
    this.#nitro = input.nitro ?? this.#nitro;
  }

  public arm(): void {
    this.#armed = true;
    this.sendReliable({ v: 1, type: "arm", sessionId: this.#sessionId });
  }

  public disarm(reason: string): void {
    this.#armed = false;
    this.neutral(reason);
  }

  public start(): void {
    if (this.#timer) {
      return;
    }
    this.#timer = setInterval(() => this.sendLatest(), 50);
  }

  public neutral(reason: string): void {
    this.#steering = 0;
    this.#throttle = 0;
    this.#brake = 1000;
    this.#nitro = false;
    this.sendReliable({ v: 1, type: "neutral", reason, sessionId: this.#sessionId });
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
      v: 1,
      type: "control",
      sessionId: this.#sessionId,
      sequence: ++this.#sequence,
      steering: this.#steering,
      throttle: this.#armed ? this.#throttle : 0,
      brake: this.#brake,
      nitro: this.#armed && this.#nitro,
      armed: this.#armed,
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

  private sendReliable(message: object): void {
    if (this.#reliableChannel?.readyState === "open") {
      this.#reliableChannel.send(JSON.stringify(message));
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0)));
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
