"use client";

import { Flag, GameController, ShieldCheck, WifiHigh } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import type { RideConnectionState } from "./ride-session-client";

const fallbackCarId = "40000000-0000-4000-8000-000000000001";

const NEUTRAL_CONTROL: KeyboardControlIntent = {
  steering: 0,
  throttle: 0,
  nitro: false,
};

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
  const videoAttemptRef = useRef<RideConnectionAttempt | null>(null);
  const attemptRef = useRef<RideConnectionAttempt | null>(null);
  const loopRef = useRef<BrowserControlLoop | null>(null);
  const armedRef = useRef(false);
  const pressedRef = useRef<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<RideConnectionState>("CONNECTING");
  const [armed, setArmed] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState("WAITING FOR VIDEO");
  const [control, setControl] = useState<KeyboardControlIntent>(NEUTRAL_CONTROL);
  const [connection, setConnection] = useState<RideConnectionSnapshot>(initialConnectionSnapshot);
  const [attemptKey, setAttemptKey] = useState(0);
  const [readyLoop, setReadyLoop] = useState<BrowserControlLoop | null>(null);

  useEffect(() => {
    setConnection(initialConnectionSnapshot());
    setState("CONNECTING");
    setError(null);
    setReadyLoop(null);
    loopRef.current = null;
    videoAttemptRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    armedRef.current = false;
    setArmed(false);

    const dependencies = createRideConnectionAttemptDependencies((sessionId) => (
      new BrowserControlLoop(sessionId, (isArmed) => {
        armedRef.current = isArmed;
        setArmed(isArmed);
      })
    ));
    const attempt = new RideConnectionAttempt(carId, {
      onSession: () => undefined,
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
      onReady: (loop, route) => {
        const browserLoop = loop as BrowserControlLoop;
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

  return (
    <div className="ride-page real-ride-page">
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
      <section className="real-ride-status data-panel" aria-live="polite">
        <p><WifiHigh size={23} /> CONNECTION <strong className={["DIRECT", "TURN", "CONNECTED"].includes(state) ? "ok" : ""}>{state}</strong></p>
        <p><GameController size={23} /> CONTROLS <strong className={armed ? "ok" : ""}>{armed ? "KEYBOARD ACTIVE" : "SAFE / NEUTRAL"}</strong></p>
        <p><ShieldCheck size={23} /> VIDEO <strong>{videoMode}</strong></p>
        {error ? <p className="real-ride-error">{error}</p> : null}
      </section>
      <section className="real-keyboard-panel" aria-label="Live keyboard controls">
        <div className="real-control-readout">
          STEER {steeringLabel(control.steering)} · THROTTLE {throttleLabel(control)}
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

function throttleLabel(control: KeyboardControlIntent): string {
  if (control.throttle < 0) return "REVERSE 63%";
  if (control.throttle > 0) return control.nitro ? "NITRO 100%" : "FORWARD 63%";
  return "NEUTRAL";
}
