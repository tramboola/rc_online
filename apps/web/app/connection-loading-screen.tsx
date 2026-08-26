"use client";

import {
  ArrowCounterClockwise,
  ArrowLeft,
  DotsThree,
  TerminalWindow,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { OperationalStatus } from "./operational-status";

export type ConnectionLoadingStatus = "connecting" | "connected" | "failed";

export type ConnectionLogEntry = {
  time: string;
  code: string;
  message: string;
  tone?: "default" | "success" | "danger";
};

const systemLogEntries: ConnectionLogEntry[] = [
  { time: "14:24:01", code: "BOOT", message: "Boot sequence started" },
  { time: "14:24:02", code: "SYS", message: "Initializing core modules" },
  { time: "14:24:03", code: "NET", message: "Connecting to RC Mania servers" },
  { time: "14:24:04", code: "AUTH", message: "Verifying driver profile" },
  { time: "14:24:05", code: "DATA", message: "Syncing live track telemetry" },
  { time: "14:24:06", code: "CFG", message: "Loading vehicle configurations" },
  { time: "14:24:07", code: "DB", message: "Accessing driver database" },
  { time: "14:24:08", code: "UI", message: "Preparing user interface" },
  { time: "14:24:09", code: "ASSET", message: "Streaming environment assets" },
  { time: "14:24:10", code: "PHYS", message: "Calibrating physics engine" },
  { time: "14:24:11", code: "NET", message: "P2P matchmaking initialized" },
  { time: "14:24:12", code: "SEC", message: "Security handshake complete" },
  { time: "14:24:13", code: "SYNC", message: "Time synchronization complete" },
  { time: "14:24:14", code: "LIVE", message: "Live track services online" },
  { time: "14:24:15", code: "RC", message: "RC systems online", tone: "success" },
  { time: "14:24:16", code: "HUD", message: "Loading heads-up display" },
  { time: "14:24:17", code: "SOUND", message: "Initializing audio systems" },
  { time: "14:24:18", code: "FINAL", message: "Final checks complete", tone: "danger" },
  { time: "14:24:19", code: "READY", message: "System ready — entering garage", tone: "danger" },
];

export function getActiveLoadingSegments(step: number): [number, number] {
  const start = ((step % 7) + 7) % 7;
  return [start, start + 1];
}

export function getConnectionUrl(carId: string): string {
  return `/loading?car=${encodeURIComponent(carId)}`;
}

export function getRideUrl(carId: string): string {
  return `/ride?car=${encodeURIComponent(carId)}`;
}

export type ConnectionLoadingOverlayProps = {
  activeStep: number;
  entries: readonly ConnectionLogEntry[];
  errorMessage: string;
  onRetry: () => void;
  onReturn: () => void;
  status: ConnectionLoadingStatus;
};

export function ConnectionBackground() {
  const [loaded, setLoaded] = useState(false);
  const fullImageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = fullImageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        className="connection-background-preview"
        decoding="async"
        src="/assets/loading-background-preview.webp?v=320q35-1"
      />
      <img
        alt=""
        aria-hidden="true"
        className="connection-background"
        data-loaded={loaded}
        decoding="async"
        fetchPriority="high"
        onLoad={() => setLoaded(true)}
        ref={fullImageRef}
        src="/assets/loading-background.webp?v=1280q65-1"
      />
    </>
  );
}

export function ConnectionLoadingOverlay({
  activeStep,
  entries,
  errorMessage,
  onRetry,
  onReturn,
  status,
}: ConnectionLoadingOverlayProps) {
  const activeSegments = useMemo(
    () => getActiveLoadingSegments(activeStep),
    [activeStep],
  );
  const statusLabel = status === "connected"
    ? "CONNECTED"
    : status === "failed"
      ? "CONNECTION FAILED"
      : "CONNECTING";

  return (
    <main className={`connection-loading-page status-${status}`}>
      <ConnectionBackground />
      <section className="connection-loading-shell" aria-labelledby="connection-title">
        <img
          alt="RC Mania"
          className="connection-logo"
          src="/assets/loading-logo.webp"
        />

        <div className="connection-kicker">
          <span aria-hidden="true" />
          <h1 id="connection-title">CONNECTING TO CAR</h1>
          <span aria-hidden="true" />
        </div>

        <div
          aria-label="Car connection in progress"
          aria-valuemax={8}
          aria-valuemin={0}
          aria-valuenow={status === "connected" ? 8 : activeSegments[1] + 1}
          className="loading-rail"
          role="progressbar"
        >
          {Array.from({ length: 8 }, (_, index) => {
            const active = activeSegments.includes(index);
            return (
              <span
                className={`loading-segment ${active ? "is-active" : ""}`}
                data-loading-segment={index + 1}
                key={index}
              />
            );
          })}
        </div>

        <section className="system-log-panel" aria-label="Connection system log">
          <header className="system-log-header">
            <strong><TerminalWindow aria-hidden="true" size={19} /> SYSTEM LOG</strong>
            <div aria-live="polite" className="connection-status">
              <span>STATUS:</span>
              <b>{statusLabel}</b>
              <DotsThree aria-hidden="true" size={25} weight="bold" />
            </div>
          </header>

          <div aria-live="off" className="system-log-lines" role="log">
            {entries.map((entry) => (
              <p className={`log-line tone-${entry.tone ?? "default"}`} key={`${entry.time}-${entry.code}-${entry.message}`}>
                <time>[{entry.time}]</time>
                <b>[{entry.code}]</b>
                <span>{entry.message}</span>
              </p>
            ))}
            {status === "failed" && errorMessage && !entries.some((entry) => entry.message === errorMessage) ? (
              <p className="log-line tone-danger">
                <time>[--:--:--]</time>
                <b>[ERROR]</b>
                <span>{errorMessage}</span>
              </p>
            ) : null}
          </div>

          {status === "failed" ? (
            <div className="connection-error-actions">
              <button onClick={onRetry} type="button">
                <ArrowCounterClockwise aria-hidden="true" size={18} weight="bold" />
                RETRY CONNECTION
              </button>
              <button onClick={onReturn} type="button">
                <ArrowLeft aria-hidden="true" size={18} weight="bold" />
                RETURN TO QUEUE
              </button>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export function ConnectionLoadingScreen(_props: {
  adminAccess: boolean;
  mockMode: boolean;
  operationalStatus?: OperationalStatus | undefined;
}) {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [visibleLogCount, setVisibleLogCount] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(media.matches);
    updateMotionPreference();
    media.addEventListener("change", updateMotionPreference);
    return () => media.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleLogCount(systemLogEntries.length);
      return;
    }

    const timer = window.setInterval(() => {
      setVisibleLogCount((count) => Math.min(count + 1, systemLogEntries.length));
    }, 360);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setActiveStep((step) => (step + 1) % 7);
    }, 420);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  const visibleEntries = systemLogEntries.slice(0, visibleLogCount);

  return (
    <ConnectionLoadingOverlay
      activeStep={activeStep}
      entries={visibleEntries}
      errorMessage=""
      onRetry={() => undefined}
      onReturn={() => router.push("/queue")}
      status="connecting"
    />
  );
}
