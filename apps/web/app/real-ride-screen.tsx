"use client";

import { BatteryHigh, Flag, GameController, ShieldCheck, WifiHigh } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { ConnectionLoadingOverlay } from "./connection-loading-screen";
import { BrowserControlLoop } from "./control-loop";
import {
  controlIntentFromPressedKeys,
  controlKeyForCode,
  isDriveKeyActive,
  type KeyboardControlIntent,
  updatePressedKeys,
} from "./keyboard-control";
import {
  createRideConnectionAttemptDependencies,
  RideConnectionAttempt,
  type RideConnectionSnapshot,
} from "./ride-connection-attempt";
import type { RideBatteryTelemetry, RideConnectionState, StoredDriveSession } from "./ride-session-client";
import { formatSessionTime, SessionCountdown } from "./session-countdown";
import { normalizeSteeringTrim, saveSteeringTrim } from "./steering-trim";
import { MobileDriveControls } from "./mobile-drive-controls";
import { MobileLandscapeNotice } from "./mobile-landscape-notice";
import { RideFullscreenToggle } from "./ride-fullscreen-toggle";

const fallbackCarId = "40000000-0000-4000-8000-000000000001";
const TRIM_SAVE_DELAY_MS = 300;

type TrimSaveStatus = "saved" | "saving" | "not-saved";

type BatteryTone = "ok" | "unknown" | "warning";

type BatteryTelemetryAction =
  | { readonly type: "RESET" }
  | { readonly type: "TELEMETRY"; readonly telemetry: RideBatteryTelemetry };

export const EMPTY_BATTERY_TELEMETRY: RideBatteryTelemetry = {
  batteryVoltage: null,
  batteryPercent: null,
};

const NEUTRAL_CONTROL: KeyboardControlIntent = {
  steering: 0,
  throttle: 0,
  nitro: false,
};

export function batteryTelemetryReducer(
  _current: RideBatteryTelemetry,
  action: BatteryTelemetryAction,
): RideBatteryTelemetry {
  return action.type === "RESET" ? EMPTY_BATTERY_TELEMETRY : action.telemetry;
}

export function getBatteryPresentation(batteryPercent: number | null): {
  label: string;
  tone: BatteryTone;
} {
  if (batteryPercent === null) return { label: formatBatteryPercent(batteryPercent), tone: "unknown" };
  return {
    label: formatBatteryPercent(batteryPercent),
    tone: batteryPercent < 20 ? "warning" : "ok",
  };
}

function initialConnectionSnapshot(): RideConnectionSnapshot {
  return {
    activeStep: 0,
    entries: [],
    errorMessage: "",
    status: "connecting",
  };
}

export function RealRideScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const carId = searchParams.get("car") ?? fallbackCarId;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rideSurfaceRef = useRef<HTMLDivElement | null>(null);
  const videoAttemptRef = useRef<RideConnectionAttempt | null>(null);
  const attemptRef = useRef<RideConnectionAttempt | null>(null);
  const loopRef = useRef<BrowserControlLoop | null>(null);
  const sessionRef = useRef<StoredDriveSession | null>(null);
  const trimSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimSaveRevisionRef = useRef(0);
  const armedRef = useRef(false);
  const pressedRef = useRef<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<RideConnectionState>("CONNECTING");
  const [armed, setArmed] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [batteryTelemetry, dispatchBatteryTelemetry] = useReducer(
    batteryTelemetryReducer,
    EMPTY_BATTERY_TELEMETRY,
  );
  const [videoMode, setVideoMode] = useState("WAITING FOR VIDEO");
  const [control, setControl] = useState<KeyboardControlIntent>(NEUTRAL_CONTROL);
  const [connection, setConnection] = useState<RideConnectionSnapshot>(initialConnectionSnapshot);
  const [attemptKey, setAttemptKey] = useState(0);
  const [readyLoop, setReadyLoop] = useState<BrowserControlLoop | null>(null);
  const [rideSession, setRideSession] = useState<StoredDriveSession | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [steeringTrimPercent, setSteeringTrimPercent] = useState(0);
  const [trimSaveStatus, setTrimSaveStatus] = useState<TrimSaveStatus>("saved");
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const battery = getBatteryPresentation(batteryTelemetry.batteryPercent);
  const applyMobileInput = useCallback((input: { steering: number; throttle: number; nitro: boolean }) => {
    loopRef.current?.setInput(input);
  }, []);

  useEffect(() => {
    setConnection(initialConnectionSnapshot());
    setState("CONNECTING");
    setError(null);
    dispatchBatteryTelemetry({ type: "RESET" });
    setReadyLoop(null);
    setRideSession(null);
    sessionRef.current = null;
    loopRef.current = null;
    videoAttemptRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    armedRef.current = false;
    setArmed(false);

    const dependencies = createRideConnectionAttemptDependencies((sessionId) => {
      const loop = new BrowserControlLoop(sessionId, (isArmed) => {
        armedRef.current = isArmed;
        setArmed(isArmed);
      }, sessionRef.current?.controlProtocolVersion ?? 3);
      loop.setSteeringTrim(sessionRef.current?.steeringTrimPercent ?? 0);
      return loop;
    });
    const attempt = new RideConnectionAttempt(carId, {
      onSession: (session) => {
        sessionRef.current = session;
        setRideSession(session);
        setSteeringTrimPercent(session.steeringTrimPercent);
        setTrimSaveStatus("saved");
      },
      onSnapshot: (snapshot) => {
        setConnection(snapshot);
        if (snapshot.status === "failed") {
          setState("DISCONNECTED");
          setError(snapshot.errorMessage);
        }
      },
      onStream: (stream) => {
        const video = videoRef.current;
        if (video) {
          videoAttemptRef.current = attempt;
          video.srcObject = stream;
          void video.play().catch(() => {
            attempt.fail("Browser could not start the camera video");
          });
        }
        const settings = stream.getVideoTracks()[0]?.getSettings();
        setVideoMode(settings?.width && settings.height
          ? `${settings.width}×${settings.height}${settings.frameRate ? ` · ${Math.round(settings.frameRate)} FPS` : ""}`
          : "LIVE VIDEO");
      },
      onTelemetry: (telemetry) => dispatchBatteryTelemetry({ type: "TELEMETRY", telemetry }),
      onReady: (loop, route) => {
        const browserLoop = loop as BrowserControlLoop;
        browserLoop.setSteeringTrim(sessionRef.current?.steeringTrimPercent ?? 0);
        loopRef.current = browserLoop;
        setReadyLoop(browserLoop);
        setState(route);
        setError(null);
      },
    }, dependencies);
    attemptRef.current = attempt;
    void attempt.start();

    return () => {
      attempt.close("ride connection replaced");
      if (videoAttemptRef.current === attempt) videoAttemptRef.current = null;
      if (attemptRef.current === attempt) attemptRef.current = null;
    };
  }, [attemptKey, carId]);

  useEffect(() => {
    if (!rideSession) {
      setRemainingSeconds(0);
      return;
    }
    const countdown = new SessionCountdown({
      onTick: setRemainingSeconds,
      onExpire: () => {
        const neutral = new Set<string>();
        pressedRef.current = neutral;
        setPressedKeys(neutral);
        setControl(NEUTRAL_CONTROL);
        loopRef.current?.setInput(NEUTRAL_CONTROL);
        loopRef.current?.disarm("session expired");
        attemptRef.current?.close("session expired");
        router.replace("/pricing");
      },
    });
    countdown.start(rideSession.expiresAt);
    return () => countdown.stop();
  }, [rideSession, router]);

  useEffect(() => () => {
    if (trimSaveTimerRef.current) clearTimeout(trimSaveTimerRef.current);
    trimSaveRevisionRef.current += 1;
  }, []);

  useEffect(() => {
    if (!readyLoop) return;
    const loop = readyLoop;

    const applyPressedKeys = (nextPressed: ReadonlySet<string>) => {
      pressedRef.current = nextPressed;
      setPressedKeys(nextPressed);
      const nextControl = controlIntentFromPressedKeys(nextPressed);
      setControl(nextControl);
      loop.setInput(nextControl);
    };
    const neutralize = (reason: string) => {
      applyPressedKeys(new Set());
      loop.disarm(reason);
    };
    const onBlur = () => neutralize("browser focus lost");
    const onFocus = () => loop.arm();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") neutralize("browser hidden");
      else loop.arm();
    };
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      const key = controlKeyForCode(event.code);
      if (!key) return;
      event.preventDefault();
      if (pressed && !armedRef.current) loop.arm();
      applyPressedKeys(updatePressedKeys(pressedRef.current, event.code, pressed));
    };
    const keyDown = (event: KeyboardEvent) => onKey(event, true);
    const keyUp = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      applyPressedKeys(new Set());
    };
  }, [readyLoop]);

  function end(): void {
    loopRef.current?.disarm("operator ended ride");
    attemptRef.current?.close("operator ended ride");
    router.push("/queue");
  }

  function retryConnection(): void {
    attemptRef.current?.close("retrying connection");
    setAttemptKey((current) => current + 1);
  }

  function returnToQueue(): void {
    attemptRef.current?.close("returning to queue");
    router.push("/queue");
  }

  function updateSteeringTrim(value: number): void {
    const next = normalizeSteeringTrim(value);
    setSteeringTrimPercent(next);
    loopRef.current?.setSteeringTrim(next);

    const session = sessionRef.current;
    if (!session) return;
    if (trimSaveTimerRef.current) clearTimeout(trimSaveTimerRef.current);
    const revision = ++trimSaveRevisionRef.current;
    setTrimSaveStatus("saving");
    trimSaveTimerRef.current = setTimeout(() => {
      trimSaveTimerRef.current = null;
      void saveSteeringTrim(session.sessionId, next)
        .then((saved) => {
          if (trimSaveRevisionRef.current !== revision) return;
          setSteeringTrimPercent(saved);
          setTrimSaveStatus("saved");
        })
        .catch(() => {
          if (trimSaveRevisionRef.current === revision) setTrimSaveStatus("not-saved");
        });
    }, TRIM_SAVE_DELAY_MS);
  }

  return (
    <div className="ride-page real-ride-page" ref={rideSurfaceRef}>
      <MobileLandscapeNotice detail="Hold it horizontally to use tilt steering and touch controls." />
      <video
        aria-label="Live onboard camera from RC Mania One"
        autoPlay
        className="drive-poster"
        muted
        onLoadedData={() => videoAttemptRef.current?.markVideoLoadedData()}
        playsInline
        ref={videoRef}
      />
      <div className="ride-shade" />
      <div className="ride-brand"><span className="brand"><span className="brand-lockup"><strong>RC</strong> MANIA</span></span><b>REAL CAR · NO AUDIO</b></div>
      <RideSessionClock remainingSeconds={remainingSeconds} />
      <button className="mobile-end-session" onClick={() => setEndConfirmationOpen(true)} type="button"><Flag size={16} /> END SESSION</button>
      <RideFullscreenToggle target={rideSurfaceRef} />
      {endConfirmationOpen ? (
        <div className="mobile-end-confirm" role="dialog" aria-modal="true" aria-labelledby="mobile-end-confirm-title">
          <section>
            <span>END CURRENT DRIVE</span>
            <strong id="mobile-end-confirm-title">ARE YOU SURE?</strong>
            <p>The car will stop and your session will end.</p>
            <div>
              <button onClick={() => setEndConfirmationOpen(false)} type="button">KEEP DRIVING</button>
              <button className="confirm" onClick={end} type="button"><Flag size={17} /> END SESSION</button>
            </div>
          </section>
        </div>
      ) : null}
      <section className="real-ride-status" aria-live="polite">
        <p><WifiHigh size={23} /> CONNECTION <strong className={["DIRECT", "TURN", "CONNECTED"].includes(state) ? "ok" : ""}>{state}</strong></p>
        <p><GameController size={23} /> CONTROLS <strong className={armed ? "ok" : ""}>{armed ? "KEYBOARD ACTIVE" : "SAFE / NEUTRAL"}</strong></p>
        <p><ShieldCheck size={23} /> VIDEO <strong>{videoMode}</strong></p>
        <p className={`real-ride-battery ${battery.tone === "warning" ? "battery-warning" : ""}`}>
          <BatteryHigh size={23} /> BATTERY
          <strong className={battery.tone === "unknown" ? "" : battery.tone}>
            {battery.label}
          </strong>
        </p>
        {error ? <p className="real-ride-error">{error}</p> : null}
      </section>
      <RideKeyboardPanel control={control} pressedKeys={pressedKeys} />
      {rideSession?.controlProtocolVersion === 5 ? (
        <MobileDriveControls
          disabled={!armed}
          onInput={applyMobileInput}
        />
      ) : null}
      <SteeringTrimControl
        disabled={!rideSession}
        onChange={updateSteeringTrim}
        onReset={() => updateSteeringTrim(0)}
        saveStatus={trimSaveStatus}
        value={steeringTrimPercent}
      />
      <div className="real-ride-actions">
        <button className="end-ride" onClick={end} type="button"><Flag size={28} /> END SESSION</button>
      </div>
      {connection.status !== "connected" ? (
        <div className="connection-loading-overlay">
          <ConnectionLoadingOverlay
            activeStep={connection.activeStep}
            entries={connection.entries}
            errorMessage={connection.errorMessage}
            onRetry={retryConnection}
            onReturn={returnToQueue}
            status={connection.status}
          />
        </div>
      ) : null}
    </div>
  );
}

export function RideSessionClock({ remainingSeconds }: { readonly remainingSeconds: number }) {
  return (
    <section className="real-session-clock" aria-label="Drive session time remaining">
      <span>SESSION</span>
      <strong>{formatSessionTime(remainingSeconds)}</strong>
    </section>
  );
}

export function formatBatteryPercent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export function SteeringTrimControl({
  disabled,
  onChange,
  onReset,
  saveStatus,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
  readonly onReset: () => void;
  readonly saveStatus: TrimSaveStatus;
  readonly value: number;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const formattedValue = `${value > 0 ? "+" : ""}${value}%`;
  const statusLabel = saveStatus === "not-saved" ? "NOT SAVED" : saveStatus.toUpperCase();
  return (
    <>
      <button className="mobile-steering-trim-toggle" disabled={disabled} onClick={() => setMobileOpen(true)} type="button">
        SET STEERING NEUTRAL <strong>{formattedValue}</strong>
      </button>
      <section className="real-steering-trim" data-mobile-open={mobileOpen} aria-label="Steering neutral adjustment">
        <header>
          <span>STEERING NEUTRAL</span>
          <strong>{formattedValue}</strong>
          <em data-status={saveStatus}>{statusLabel}</em>
        </header>
        <div>
          <small>-20%</small>
          <input
            aria-label="Steering neutral trim"
            disabled={disabled}
            max={20}
            min={-20}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
            onKeyDown={(event) => event.stopPropagation()}
            step={1}
            type="range"
            value={value}
          />
          <small>+20%</small>
          <button disabled={disabled || value === 0} onClick={onReset} type="button">RESET</button>
          <button className="mobile-steering-trim-done" onClick={() => setMobileOpen(false)} type="button">DONE</button>
        </div>
      </section>
    </>
  );
}

function KeyCap({
  active,
  className = "",
  label,
  sublabel,
}: {
  readonly active: boolean;
  readonly className?: string;
  readonly label: string;
  readonly sublabel?: string;
}) {
  return (
    <span aria-pressed={active} className={`real-keycap ${className}`} data-active={active}>
      <b>{label}</b>{sublabel ? <small>{sublabel}</small> : null}
    </span>
  );
}

function steeringLabel(steering: -1 | 0 | 1): string {
  return steering < 0 ? "LEFT" : steering > 0 ? "RIGHT" : "CENTER";
}

export function formatThrottleLabel(control: KeyboardControlIntent): string {
  if (control.throttle < 0) return "REVERSE";
  if (control.throttle > 0) return control.nitro ? "NITRO" : "FORWARD";
  return "NEUTRAL";
}

export function RideKeyboardPanel({
  control,
  pressedKeys,
}: {
  readonly control: KeyboardControlIntent;
  readonly pressedKeys: ReadonlySet<string>;
}) {
  return (
    <section className="real-keyboard-panel" aria-label="Live keyboard controls">
      <div className="real-control-readout">
        STEER {steeringLabel(control.steering)} · THROTTLE {formatThrottleLabel(control)}
      </div>
      <div className="real-keyboard-layout">
        <div className="real-wasd" aria-label="WASD and arrow keys">
          <KeyCap active={isDriveKeyActive(pressedKeys, "W")} className="key-w" label="W" sublabel="/↑" />
          <KeyCap active={isDriveKeyActive(pressedKeys, "A")} className="key-a" label="A" sublabel="/←" />
          <KeyCap active={isDriveKeyActive(pressedKeys, "S")} className="key-s" label="S" sublabel="/↓" />
          <KeyCap active={isDriveKeyActive(pressedKeys, "D")} className="key-d" label="D" sublabel="/→" />
        </div>
        <KeyCap active={isDriveKeyActive(pressedKeys, "NITRO")} className="key-nitro" label="N" sublabel="NITRO" />
      </div>
      <p>WASD / ARROWS TO DRIVE · N NITRO</p>
    </section>
  );
}
