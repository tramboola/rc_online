"use client";

import { ArrowRight, CheckCircle, Circle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { MobileDriveControls } from "./mobile-drive-controls";
import { MobileLandscapeNotice } from "./mobile-landscape-notice";

const discardPreflightInput = () => undefined;

export function MobilePreflight() {
  const router = useRouter();
  const [motionReady, setMotionReady] = useState(false);
  const [touchReady, setTouchReady] = useState(false);
  const ready = motionReady && touchReady;

  const confirmMotion = useCallback(() => setMotionReady(true), []);
  const confirmTouch = useCallback(() => setTouchReady(true), []);

  return (
    <section className="mobile-preflight">
      <MobileLandscapeNotice detail="Hold it horizontally to check tilt steering and touch controls." />
      <div className="mobile-preflight-landscape">
        <header>
          <div>
            <p className="eyebrow">MOBILE DRIVING SETUP</p>
            <h1>PHONE CONTROL CHECK</h1>
          </div>
          <p>Move each control once. Nothing is sent to the car during this check.</p>
        </header>
        <article className="data-panel mobile-preflight-panel">
          <MobileDriveControls
            disabled={false}
            onInput={discardPreflightInput}
            onTiltActivity={confirmMotion}
            onTouchActivity={confirmTouch}
          />
          <div className="mobile-preflight-status" aria-live="polite">
            <span className={motionReady ? "ready" : ""}>
              {motionReady ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
              MOTION SENSOR
              <small>{motionReady ? "TILT DETECTED" : "ENABLE AND TILT"}</small>
            </span>
            <span className={touchReady ? "ready" : ""}>
              {touchReady ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
              TOUCH CONTROLS
              <small>{touchReady ? "INPUT DETECTED" : "TRY THROTTLE OR NITRO"}</small>
            </span>
          </div>
        </article>
        <footer className="data-panel mobile-preflight-footer">
          <div>
            <strong>{ready ? "PHONE CONTROLS READY" : "CHECK BOTH CONTROLS"}</strong>
            <small>{ready ? "You are ready to join the live queue." : "Tilt the phone and touch one driving control."}</small>
          </div>
          <button
            className="action-button action-red"
            disabled={!ready}
            onClick={() => router.push("/queue")}
            type="button"
          >
            <span>CONTINUE TO QUEUE</span>
            <ArrowRight size={21} weight="bold" />
          </button>
        </footer>
      </div>
    </section>
  );
}
