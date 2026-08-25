import type { BrowserControlLoop } from "./control-loop";
import {
  createAdminDriveSession,
  RideSessionClient,
  type RideBatteryTelemetry,
  type RideConnectionState,
  type RideConnectionProgress,
  type StoredDriveSession,
} from "./ride-session-client";
import type {
  ConnectionLoadingStatus,
  ConnectionLogEntry,
} from "./connection-loading-screen";

export type RideControlLoop = Pick<
  BrowserControlLoop,
  "arm" | "bindChannels" | "disarm" | "setInput" | "setSteeringTrim" | "start" | "stop"
>;

type RideSessionClientLike = Pick<
  RideSessionClient,
  "channels" | "close" | "connect" | "onError" | "onProgress" | "onState" | "onStream" | "onTelemetry"
>;

export type RideConnectionSnapshot = {
  activeStep: number;
  entries: readonly ConnectionLogEntry[];
  errorMessage: string;
  status: ConnectionLoadingStatus;
};

export type RideConnectionAttemptCallbacks = {
  onSnapshot: (snapshot: RideConnectionSnapshot) => void;
  onSession: (session: StoredDriveSession) => void;
  onStream: (stream: MediaStream) => void;
  onTelemetry: (telemetry: RideBatteryTelemetry) => void;
  onReady: (loop: RideControlLoop, route: Exclude<RideConnectionState, "CONNECTING" | "DISCONNECTED">) => void;
};

export type RideConnectionAttemptDependencies = {
  clearTimeout: (handle: number) => void;
  createClient: (session: StoredDriveSession) => RideSessionClientLike;
  createLoop: (sessionId: string) => RideControlLoop;
  createSession: (carId: string) => Promise<StoredDriveSession>;
  now: () => Date;
  setTimeout: (callback: () => void, milliseconds: number) => number;
};

const progressDetails: Record<
  RideConnectionProgress,
  { step: number; code: string; message: string }
> = {
  "gateway.connecting": { step: 1, code: "NET", message: "Connecting to RC Mania gateway" },
  "gateway.connected": { step: 2, code: "NET", message: "Gateway connected" },
  "session.started": { step: 3, code: "SESSION", message: "Drive session started" },
  "webrtc.offer-sent": { step: 4, code: "WEBRTC", message: "Camera connection requested" },
  "webrtc.answer-applied": { step: 5, code: "WEBRTC", message: "Camera response received" },
  "webrtc.direct": { step: 6, code: "WEBRTC", message: "Direct connection established" },
  "webrtc.turn": { step: 6, code: "WEBRTC", message: "TURN fallback connection established" },
  "webrtc.connected": { step: 6, code: "WEBRTC", message: "WebRTC connection established" },
  "video.track-received": { step: 7, code: "VIDEO", message: "Camera stream received" },
};

const defaultDependencies: RideConnectionAttemptDependencies = {
  clearTimeout: (handle) => window.clearTimeout(handle),
  createClient: (session) => new RideSessionClient(session),
  createLoop: (sessionId) => {
    throw new Error(`Control loop factory is required for session ${sessionId}`);
  },
  createSession: createAdminDriveSession,
  now: () => new Date(),
  setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
};

export class RideConnectionAttempt {
  readonly #carId: string;
  readonly #callbacks: RideConnectionAttemptCallbacks;
  readonly #dependencies: RideConnectionAttemptDependencies;
  #active = false;
  #ready = false;
  #connectedRoute: Exclude<RideConnectionState, "CONNECTING" | "DISCONNECTED"> | null = null;
  #videoLoadedData = false;
  #activeStep = 0;
  #entries: ConnectionLogEntry[] = [];
  #client: RideSessionClientLike | null = null;
  #loop: RideControlLoop | null = null;
  #timeoutHandle: number | null = null;

  public constructor(
    carId: string,
    callbacks: RideConnectionAttemptCallbacks,
    dependencies: RideConnectionAttemptDependencies,
  ) {
    this.#carId = carId;
    this.#callbacks = callbacks;
    this.#dependencies = dependencies;
  }

  public async start(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    this.#append("SESSION", "Creating drive session");
    this.#timeoutHandle = this.#dependencies.setTimeout(
      () => this.fail("Camera connection timed out"),
      15_000,
    );

    try {
      const session = await this.#dependencies.createSession(this.#carId);
      if (!this.#active) return;
      this.#callbacks.onSession(session);

      const client = this.#dependencies.createClient(session);
      const loop = this.#dependencies.createLoop(session.sessionId);
      this.#client = client;
      this.#loop = loop;
      client.onProgress = (progress) => this.#handleProgress(progress);
      client.onState = (state) => {
        if (!this.#active) return;
        if (state === "DIRECT" || state === "TURN" || state === "CONNECTED") {
          this.#connectedRoute = state;
          this.#tryReady();
        } else if (state === "DISCONNECTED" && !this.#ready) {
          this.fail("Camera connection was interrupted");
        }
      };
      client.onStream = (stream) => {
        if (this.#active) this.#callbacks.onStream(stream);
      };
      client.onTelemetry = (telemetry) => {
        if (this.#active) this.#callbacks.onTelemetry(telemetry);
      };
      client.onError = (message) => this.fail(message);
      client.connect();

      const channels = client.channels;
      if (!channels) throw new Error("Control channels could not be created");
      loop.bindChannels(channels.fast, channels.reliable);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not connect to the car");
    }
  }

  public markVideoLoadedData(): void {
    if (!this.#active || this.#ready || this.#videoLoadedData) return;
    this.#videoLoadedData = true;
    this.#activeStep = Math.max(this.#activeStep, 7);
    this.#append("VIDEO", "First camera frame decoded", "success");
    this.#tryReady();
  }

  public fail(message: string): void {
    if (!this.#active || this.#ready) return;
    this.#active = false;
    this.#cancelTimeout();
    this.#teardown("connection failed");
    this.#append("ERROR", message, "danger", "failed", message);
  }

  public close(reason = "browser closed session"): void {
    if (!this.#active && !this.#client && !this.#loop) return;
    this.#active = false;
    this.#cancelTimeout();
    this.#teardown(reason);
  }

  #handleProgress(progress: RideConnectionProgress): void {
    if (!this.#active || this.#ready) return;
    const detail = progressDetails[progress];
    this.#activeStep = Math.max(this.#activeStep, detail.step);
    this.#append(detail.code, detail.message);
  }

  #tryReady(): void {
    if (!this.#active || this.#ready || !this.#connectedRoute || !this.#videoLoadedData || !this.#loop) return;
    this.#ready = true;
    this.#cancelTimeout();
    this.#activeStep = 7;
    this.#append("READY", "Camera ready", "success", "connected");
    this.#loop.start();
    this.#loop.arm();
    this.#callbacks.onReady(this.#loop, this.#connectedRoute);
  }

  #append(
    code: string,
    message: string,
    tone: ConnectionLogEntry["tone"] = "default",
    status: ConnectionLoadingStatus = "connecting",
    errorMessage = "",
  ): void {
    this.#entries.push({
      time: this.#dependencies.now().toISOString().slice(11, 19),
      code,
      message,
      tone,
    });
    this.#callbacks.onSnapshot({
      activeStep: this.#activeStep,
      entries: [...this.#entries],
      errorMessage,
      status,
    });
  }

  #cancelTimeout(): void {
    if (this.#timeoutHandle === null) return;
    this.#dependencies.clearTimeout(this.#timeoutHandle);
    this.#timeoutHandle = null;
  }

  #teardown(reason: string): void {
    const loop = this.#loop;
    const client = this.#client;
    this.#loop = null;
    this.#client = null;
    loop?.disarm(reason);
    loop?.stop();
    client?.close(reason);
  }
}

export function createRideConnectionAttemptDependencies(
  createLoop: (sessionId: string) => RideControlLoop,
): RideConnectionAttemptDependencies {
  return { ...defaultDependencies, createLoop };
}
