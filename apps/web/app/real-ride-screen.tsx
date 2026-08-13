"use client";

import { Flag, GameController, ShieldCheck, WifiHigh } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrowserControlLoop } from "./control-loop";
import { loadDriveSession, RideSessionClient } from "./ride-session-client";

export function RealRideScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clientRef = useRef<RideSessionClient | null>(null);
  const loopRef = useRef<BrowserControlLoop | null>(null);
  const armedRef = useRef(false);
  const [state, setState] = useState<"CONNECTING" | "DIRECT" | "DISCONNECTED">("CONNECTING");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState("WAITING FOR VIDEO");
  const [control, setControl] = useState({ steering: 0, throttle: 0, brake: 0, nitro: false });

  useEffect(() => {
    const session = loadDriveSession();
    if (!session) {
      setState("DISCONNECTED");
      setError("No active drive session. Select RC Mania One again.");
      return;
    }
    const client = new RideSessionClient(session);
    const loop = new BrowserControlLoop(session.sessionId);
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

    const neutralize = (reason: string) => {
      loop.disarm(reason);
      armedRef.current = false;
      setArmed(false);
      setControl({ steering: 0, throttle: 0, brake: 1000, nitro: false });
    };
    const onBlur = () => neutralize("browser focus lost");
    const onVisibility = () => {
      if (document.visibilityState !== "visible") neutralize("browser hidden");
    };
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      if (event.key === "Escape") {
        neutralize("escape pressed");
        return;
      }
      if (!armedRef.current && pressed) return;
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "shift"].includes(key)) event.preventDefault();
      setControl((current) => {
        const next = { ...current };
        if (key === "arrowup" || key === "w") next.throttle = pressed ? 700 : 0;
        if (key === "arrowdown" || key === "s") next.brake = pressed ? 1000 : 0;
        if (key === "arrowleft" || key === "a") next.steering = pressed ? -700 : 0;
        if (key === "arrowright" || key === "d") next.steering = pressed ? 700 : 0;
        if (key === "shift") next.nitro = pressed;
        loop.setInput(next);
        return next;
      });
    };
    const keyDown = (event: KeyboardEvent) => onKey(event, true);
    const keyUp = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      loop.stop();
      client.close("ride screen closed");
    };
  }, []);

  function arm(): void {
    if (state !== "DIRECT") return;
    loopRef.current?.arm();
    armedRef.current = true;
    setArmed(true);
    setControl({ steering: 0, throttle: 0, brake: 0, nitro: false });
  }

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
        <p><GameController size={23} /> CONTROLS <strong>{armed ? "ARMED" : "SAFE / NEUTRAL"}</strong></p>
        <p><ShieldCheck size={23} /> VIDEO <strong>{videoMode}</strong></p>
        {error ? <p className="real-ride-error">{error}</p> : null}
      </section>
      <div className="real-control-readout">STEER {control.steering} · THROTTLE {control.throttle} · BRAKE {control.brake}{control.nitro ? " · NITRO" : ""}</div>
      <div className="real-ride-actions">
        <button className="action-button" disabled={state !== "DIRECT" || armed} onClick={arm} type="button">{armed ? "CONTROLS ARMED" : "ARM CONTROLS"}</button>
        <button className="end-ride" onClick={end} type="button"><Flag size={28} /> END SESSION</button>
      </div>
    </div>
  );
}
