"use client";

import { CornersIn, CornersOut } from "@phosphor-icons/react";
import { useEffect, useState, type RefObject } from "react";

export function RideFullscreenToggle({
  target,
}: {
  readonly target: RefObject<HTMLElement | null>;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [target]);

  async function toggle(): Promise<void> {
    setError("");
    try {
      if (document.fullscreenElement) {
        if (typeof document.exitFullscreen !== "function") throw new Error("unsupported");
        await document.exitFullscreen();
        setActive(false);
        return;
      }

      const surface = target.current;
      if (!surface || typeof surface.requestFullscreen !== "function") throw new Error("unsupported");
      await surface.requestFullscreen({ navigationUI: "hide" });
      setActive(true);
    } catch {
      setError("FULLSCREEN UNAVAILABLE");
    }
  }

  return (
    <div className="mobile-fullscreen-control">
      <button aria-label={active ? "EXIT FULL SCREEN" : "FULL SCREEN"} onClick={toggle} type="button">
        {active ? <CornersIn size={14} /> : <CornersOut size={14} />}
        {active ? "EXIT FULL SCREEN" : "FULL SCREEN"}
      </button>
      {error ? <span role="status">{error}</span> : null}
    </div>
  );
}
