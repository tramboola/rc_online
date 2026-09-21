import { normalizeSteeringTrim } from "./steering-trim";

interface DriveCommandBase {
  readonly type: "control.intent";
  readonly sessionId: string;
  readonly sequence: number;
  readonly steering: number;
  readonly throttle: number;
  readonly nitro: boolean;
  readonly armed: boolean;
}

export type DriveCommand =
  | (DriveCommandBase & { readonly v: 3 })
  | (DriveCommandBase & { readonly v: 4 | 5; readonly steeringTrimPercent: number });

interface ControlInput {
  readonly steering?: number;
  readonly throttle?: number;
  readonly nitro?: boolean;
}

export class BrowserControlLoop {
  readonly #sessionId: string;
  readonly #onArmedChange: ((armed: boolean) => void) | undefined;
  readonly #protocolVersion: 3 | 4 | 5;
  #fastChannel: RTCDataChannel | null = null;
  #reliableChannel: RTCDataChannel | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #sequence = 0;
  #steering = 0;
  #throttle = 0;
  #nitro = false;
  #steeringTrimPercent = 0;
  #armRequested = false;
  #armed = false;
  #congestedAt: number | null = null;
  #inputProvider: (() => ControlInput) | null = null;

  public constructor(
    sessionId: string,
    onArmedChange?: (armed: boolean) => void,
    protocolVersion: 3 | 4 | 5 = 3,
  ) {
    this.#sessionId = sessionId;
    this.#onArmedChange = onArmedChange;
    this.#protocolVersion = protocolVersion;
  }

  public bindChannels(
    fastChannel: RTCDataChannel,
    reliableChannel: RTCDataChannel,
  ): void {
    this.#unbindChannels();
    this.#fastChannel = fastChannel;
    this.#reliableChannel = reliableChannel;
    for (const channel of [fastChannel, reliableChannel]) {
      channel.addEventListener("open", this.#tryArm);
      channel.addEventListener("close", this.#handleChannelClose);
      channel.addEventListener("error", this.#handleChannelClose);
    }
    this.#tryArm();
  }

  public setInput(input: ControlInput): void {
    // Direct input (including phone controls) takes ownership from timed input.
    this.#inputProvider = null;
    this.applyInput(input);
  }

  public setInputProvider(provider: (() => ControlInput) | null): void {
    this.#inputProvider = provider;
  }

  private applyInput(input: ControlInput): void {
    this.#steering = normalizedAxis(input.steering ?? this.#steering);
    this.#throttle = normalizedAxis(input.throttle ?? this.#throttle);
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
    this.#inputProvider = null;
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
    this.#unbindChannels();
  }

  readonly #tryArm = (): void => {
    if (!this.#armRequested || this.#armed || this.#fastChannel?.readyState !== "open"
      || this.#reliableChannel?.readyState !== "open"
      || this.#fastChannel.bufferedAmount > 0 || this.#reliableChannel.bufferedAmount > 0) return;
    if (this.sendReliable({ v: 3, type: "arm", sessionId: this.#sessionId })) this.#setArmed(true);
  };

  readonly #handleChannelClose = (): void => {
    this.#transportFailed("control_channel_closed");
  };

  #transportFailed(reason: string): void {
    this.#armRequested = false;
    this.#inputProvider = null;
    this.#steering = 0;
    this.#throttle = 0;
    this.#nitro = false;
    this.#setArmed(false);
    // Best effort only: never recurse through sendReliable on a broken channel.
    if (this.#reliableChannel?.readyState === "open" && this.#reliableChannel.bufferedAmount === 0) {
      try {
        this.#reliableChannel.send(JSON.stringify({ v: 3, type: "neutral", reason, sessionId: this.#sessionId }));
      } catch { /* The independent Pi command watchdog still stops the car. */ }
    }
  }

  #unbindChannels(): void {
    for (const channel of [this.#fastChannel, this.#reliableChannel]) {
      channel?.removeEventListener("open", this.#tryArm);
      channel?.removeEventListener("close", this.#handleChannelClose);
      channel?.removeEventListener("error", this.#handleChannelClose);
    }
  }

  #setArmed(armed: boolean): void {
    if (this.#armed === armed) return;
    this.#armed = armed;
    this.#onArmedChange?.(armed);
  }

  private sendLatest(): void {
    if (this.#fastChannel?.readyState === "open" && this.#fastChannel.bufferedAmount > 0) {
      this.#congestedAt ??= performance.now();
      if (this.#armed && performance.now() - this.#congestedAt >= 200) {
        this.#transportFailed("control_channel_congested");
      }
      // Keep at most the packet already handed to SCTP, not a backlog of intent.
      return;
    }
    this.#congestedAt = null;
    // Sample immediately before encoding, using the existing 50 Hz send clock.
    if (this.#armed && this.#inputProvider) this.applyInput(this.#inputProvider());
    const proportional = this.#protocolVersion === 5;
    const base: DriveCommandBase = {
      type: "control.intent",
      sessionId: this.#sessionId,
      sequence: ++this.#sequence,
      steering: this.#armed ? encodeAxis(this.#steering, proportional) : 0,
      throttle: this.#armed ? encodeAxis(this.#throttle, proportional) : 0,
      nitro: this.#armed && this.#nitro,
      armed: this.#armed,
    };
    const command: DriveCommand = this.#protocolVersion >= 4
      ? { v: this.#protocolVersion, ...base, steeringTrimPercent: this.#steeringTrimPercent }
      : { v: 3, ...base };
    if (this.#fastChannel?.readyState === "open") {
      try {
        this.#fastChannel.send(JSON.stringify(command));
      } catch {
        this.#transportFailed("control_send_failed");
      }
      return;
    }
    // A broken WebRTC channel must never reroute held input through HTTP.
    if (this.#fastChannel) return;
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

  private sendReliable(message: object): boolean {
    if (this.#reliableChannel?.readyState === "open" && !(this.#reliableChannel.bufferedAmount > 0)) {
      try {
        this.#reliableChannel.send(JSON.stringify(message));
        return true;
      } catch {
        this.#transportFailed("control_send_failed");
      }
    }
    return false;
  }
}

function discreteAxis(value: number): -1 | 0 | 1 {
  if (!Number.isFinite(value) || value === 0) return 0;
  return value < 0 ? -1 : 1;
}

function normalizedAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function encodeAxis(value: number, proportional: boolean): number {
  return proportional ? Math.round(normalizedAxis(value) * 1000) : discreteAxis(value);
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
