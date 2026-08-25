"use client";

import { useEffect, useRef, useState } from "react";

import { mapThrottlePosition, mapTiltToSteering, smoothAxis, throttleAxisToTrackPercent } from "./mobile-control";

type DeviceOrientationPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function MobileDriveControls({
  disabled,
  onInput,
}: {
  readonly disabled: boolean;
  readonly onInput: (input: { steering: number; throttle: number; nitro: boolean }) => void;
}) {
  const centerRef = useRef<number | null>(null);
  const steeringRef = useRef(0);
  const throttleRef = useRef(0);
  const nitroRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [steering, setSteering] = useState(0);
  const [throttle, setThrottle] = useState(0);
  const [nitro, setNitro] = useState(false);

  const publish = (nextSteering: number, nextThrottle: number, nextNitro = nitroRef.current) => {
    steeringRef.current = nextSteering;
    throttleRef.current = nextThrottle;
    setSteering(nextSteering);
    setThrottle(nextThrottle);
    nitroRef.current = nextNitro;
    setNitro(nextNitro);
    onInput({ steering: nextSteering, throttle: nextThrottle, nitro: nextNitro });
  };

  useEffect(() => {
    if (!enabled || disabled) return;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const angle = screen.orientation?.angle ?? window.orientation ?? 0;
      const rawTilt = angle === 90
        ? event.beta
        : angle === 270 || angle === -90
          ? event.beta === null ? null : -event.beta
          : event.gamma;
      if (rawTilt === null || !Number.isFinite(rawTilt)) return;
      if (centerRef.current === null) centerRef.current = rawTilt;
      const target = mapTiltToSteering(rawTilt, centerRef.current);
      publish(smoothAxis(steeringRef.current, target), throttleRef.current);
    };
    const neutralize = () => publish(0, 0, false);
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("blur", neutralize);
    document.addEventListener("visibilitychange", neutralize);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("blur", neutralize);
      document.removeEventListener("visibilitychange", neutralize);
      neutralize();
    };
  }, [disabled, enabled, onInput]);

  async function enableTilt(): Promise<void> {
    if (!("DeviceOrientationEvent" in window)) {
      setError("MOTION SENSOR IS NOT AVAILABLE");
      return;
    }
    const orientation = DeviceOrientationEvent as DeviceOrientationPermission;
    if (orientation.requestPermission) {
      const permission = await orientation.requestPermission().catch(() => "denied" as const);
      if (permission !== "granted") {
        setError("MOTION ACCESS WAS NOT ALLOWED");
        return;
      }
    }
    centerRef.current = null;
    setError("");
    setEnabled(true);
  }

  function updateThrottle(event: React.PointerEvent<HTMLDivElement>): void {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const axis = mapThrottlePosition(event.clientY - bounds.top, bounds.height);
    publish(steeringRef.current, Math.abs(axis) < 0.04 ? 0 : axis);
  }

  function releaseThrottle(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    publish(steeringRef.current, 0);
  }

  function setNitroPressed(pressed: boolean): void {
    if (disabled && pressed) return;
    publish(steeringRef.current, throttleRef.current, pressed);
  }

  const outputPercent = throttle > 0
    ? Math.round(throttle * (nitro ? 100 : 63))
    : Math.round(Math.abs(throttle) * 100);

  return (
    <section className="mobile-drive-controls" aria-label="Phone driving controls">
      <div className="mobile-steering-meter">
        <span>TILT STEERING</span>
        <div><i style={{ left: `${50 + steering * 50}%` }} /></div>
        <strong>{Math.round(steering * 100)}%</strong>
        <button disabled={disabled} onClick={enableTilt} type="button">
          {enabled ? "RE-CENTER" : "ENABLE TILT STEERING"}
        </button>
        {error ? <em>{error}</em> : null}
      </div>
      <div
        className="mobile-throttle-pad"
      >
        <span>FORWARD</span>
        <div
          aria-label="Proportional throttle and reverse"
          className="mobile-throttle-track"
          onPointerCancel={releaseThrottle}
          onPointerDown={updateThrottle}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateThrottle(event); }}
          onPointerUp={releaseThrottle}
        ><i style={{ top: `${throttleAxisToTrackPercent(throttle)}%` }} /></div>
        <strong>{outputPercent}%</strong>
        <span>REVERSE</span>
      </div>
      <button
        aria-pressed={nitro}
        className="mobile-nitro-button"
        disabled={disabled}
        onPointerCancel={() => setNitroPressed(false)}
        onPointerDown={() => setNitroPressed(true)}
        onPointerLeave={() => setNitroPressed(false)}
        onPointerUp={() => setNitroPressed(false)}
        type="button"
      >
        <b>NITRO</b>
      </button>
    </section>
  );
}
