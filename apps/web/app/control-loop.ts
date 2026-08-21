import { normalizeSteeringTrim } from "./steering-trim";

export interface DriveCommand {
  readonly v: 4;
  readonly type: "control.intent";
  readonly sessionId: string;
  readonly sequence: number;
  readonly steering: -1 | 0 | 1;
  readonly throttle: -1 | 0 | 1;
  readonly steeringTrimPercent: number;
  readonly nitro: boolean;
  readonly armed: boolean;
}

interface ControlInput {
  readonly steering?: number;
  readonly throttle?: number;
  readonly nitro?: boolean;
}

export class BrowserControlLoop {
  readonly #sessionId: string;
  readonly #onArmedChange: ((armed: boolean) => void) | undefined;
  #fastChannel: RTCDataChannel | null = null;
  #reliableChannel: RTCDataChannel | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #sequence = 0;
  #steering: -1 | 0 | 1 = 0;
  #throttle: -1 | 0 | 1 = 0;
  #nitro = false;
  #steeringTrimPercent = 0;
  #armRequested = false;
  #armed = false;

  public constructor(sessionId: string, onArmedChange?: (armed: boolean) => void) {
    this.#sessionId = sessionId;
    this.#onArmedChange = onArmedChange;
  }

  public bindChannels(
    fastChannel: RTCDataChannel,
    reliableChannel: RTCDataChannel,
  ): void {
    this.#fastChannel = fastChannel;
    this.#reliableChannel = reliableChannel;
    reliableChannel.addEventListener("open", this.#tryArm);
    reliableChannel.addEventListener("close", this.#handleChannelClose);
    this.#tryArm();
  }

  public setInput(input: ControlInput): void {
    this.#steering = discreteAxis(input.steering ?? this.#steering);
    this.#throttle = discreteAxis(input.throttle ?? this.#throttle);
    this.#nitro = input.nitro ?? this.#nitro;
  }

  public setSteeringTrim(percent: number): void {
    this.#steeringTrimPercent = normalizeSteeringTrim(percent);
  }

  public arm(): void {
    this.#armRequested = true;
    this.#tryArm();
  }

  public disarm(reason: string): void {
    this.#armRequested = false;
    this.#setArmed(false);
    this.neutral(reason);
  }

  public start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.sendLatest(), 20);
  }

  public neutral(reason: string): void {
    this.#steering = 0;
    this.#throttle = 0;
    this.#nitro = false;
    this.sendReliable({ v: 3, type: "neutral", reason, sessionId: this.#sessionId });
    this.sendLatest();
  }

  public stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#armRequested = false;
    this.#setArmed(false);
    this.neutral("control_loop_stopped");
  }

  readonly #tryArm = (): void => {
    if (!this.#armRequested || this.#reliableChannel?.readyState !== "open") return;
    this.sendReliable({ v: 3, type: "arm", sessionId: this.#sessionId });
    this.#setArmed(true);
  };

  readonly #handleChannelClose = (): void => {
    this.#setArmed(false);
  };

  #setArmed(armed: boolean): void {
    if (this.#armed === armed) return;
    this.#armed = armed;
    this.#onArmedChange?.(armed);
  }

  private sendLatest(): void {
    const command: DriveCommand = {
      v: 4,
      type: "control.intent",
      sessionId: this.#sessionId,
      sequence: ++this.#sequence,
      steering: this.#armed ? this.#steering : 0,
      throttle: this.#armed ? this.#throttle : 0,
      steeringTrimPercent: this.#steeringTrimPercent,
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
    if (!edgeOrigin) return;
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

function discreteAxis(value: number): -1 | 0 | 1 {
  if (!Number.isFinite(value) || value === 0) return 0;
  return value < 0 ? -1 : 1;
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
