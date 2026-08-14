"use client";

import { Flag, GameController, ShieldCheck, WifiHigh } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrowserControlLoop } from "./control-loop";
import {
  controlIntentFromPressedKeys,
  controlKeyForCode,
  isDriveKeyActive,
  type KeyboardControlIntent,
  updatePressedKeys,
} from "./keyboard-control";
import { loadDriveSession, RideSessionClient } from "./ride-session-client";

const NEUTRAL_CONTROL: KeyboardControlIntent = {
  steering: 0,
  throttle: 0,
  brake: false,
  nitro: false,
};

export function RealRideScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clientRef = useRef<RideSessionClient | null>(null);
  const loopRef = useRef<BrowserControlLoop | null>(null);
  const armedRef = useRef(false);
  const pressedRef = useRef<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<"CONNECTING" | "DIRECT" | "DISCONNECTED">("CONNECTING");
  const [armed, setArmed] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState("WAITING FOR VIDEO");
  const [control, setControl] = useState<KeyboardControlIntent>(NEUTRAL_CONTROL);

  useEffect(() => {
    const session = loadDriveSession();
    if (!session) {
      setState("DISCONNECTED");
      setError("No active drive session. Select RC Mania One again.");
      return;
    }
    const client = new RideSessionClient(session);
    const loop = new BrowserControlLoop(session.sessionId, (isArmed) => {
      armedRef.current = isArmed;
      setArmed(isArmed);
    });
    clientRef.current = client;
    loopRef.current = loop;
    client.onState = setState;
    client.onError = setError;
    client.onStream = (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setVideoMode(settings?.width && settings.height
        ? `${settings.width}×${settings.height}${settings.frameRate ? ` · ${Math.round(settings.frameRate)} FPS` : ""}`
        : "LIVE VIDEO");
    };
    client.connect();
    const channels = client.channels;
    if (channels) loop.bindChannels(channels.fast, channels.reliable);
    loop.start();
    loop.arm();

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
      if (key === "STOP") {
        if (pressed) neutralize("escape pressed");
        return;
      }
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
      loop.stop();
      client.close("ride screen closed");
    };
  }, []);

  function end(): void {
    loopRef.current?.disarm("operator ended ride");
    clientRef.current?.close("operator ended ride");
    router.push("/queue");
  }

  return (
    <div className="ride-page real-ride-page">
      <video aria-label="Live onboard camera from RC Mania One" autoPlay className="drive-poster" muted playsInline ref={videoRef} />
      <div className="ride-shade" />
      <div className="ride-brand"><span className="brand"><span className="brand-lockup"><strong>RC</strong> MANIA</span></span><b>REAL CAR · NO AUDIO</b></div>
      <section className="real-ride-status data-panel" aria-live="polite">
        <p><WifiHigh size={23} /> CONNECTION <strong className={state === "DIRECT" ? "ok" : ""}>{state}</strong></p>
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
            <KeyCap active={isDriveKeyActive(pressedKeys, "W")} className="key-w" label="W" />
            <KeyCap active={isDriveKeyActive(pressedKeys, "A")} className="key-a" label="A" />
            <KeyCap active={isDriveKeyActive(pressedKeys, "S")} className="key-s" label="S" />
            <KeyCap active={isDriveKeyActive(pressedKeys, "D")} className="key-d" label="D" />
          </div>
          <KeyCap active={isDriveKeyActive(pressedKeys, "BRAKE")} className="key-wide" label="SPACE" sublabel="BRAKE" />
          <KeyCap active={isDriveKeyActive(pressedKeys, "NITRO")} className="key-nitro" label="N" sublabel="NITRO" />
        </div>
        <p>WASD / ARROWS TO DRIVE · SPACE BRAKE · N NITRO · ESC STOP</p>
      </section>
      <div className="real-ride-actions">
        <button className="end-ride" onClick={end} type="button"><Flag size={28} /> END SESSION</button>
      </div>
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
  if (control.brake) return "BRAKE";
  if (control.throttle < 0) return "REVERSE 63%";
  if (control.throttle > 0) return control.nitro ? "NITRO 100%" : "FORWARD 63%";
  return "NEUTRAL";
}
