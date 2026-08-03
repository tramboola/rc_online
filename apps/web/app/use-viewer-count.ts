"use client";

import { useEffect, useState } from "react";

import { getOrCreateViewerId, sendViewerHeartbeat } from "./viewer-client";

const heartbeatIntervalMs = 15_000;

export type ViewerCountState = {
  count: number | null;
  unavailable: boolean;
};

export function useViewerCount(): ViewerCountState {
  const [state, setState] = useState<ViewerCountState>({
    count: null,
    unavailable: false,
  });

  useEffect(() => {
    let active = true;
    let storage: Storage | null = null;

    try {
      storage = window.localStorage;
    } catch {
      // Browser privacy settings may block localStorage.
    }

    const viewerId = getOrCreateViewerId(storage);

    async function heartbeat() {
      try {
        const count = await sendViewerHeartbeat(viewerId);
        if (active) {
          setState({ count, unavailable: false });
        }
      } catch {
        if (active) {
          setState({ count: null, unavailable: true });
        }
      }
    }

    void heartbeat();
    const intervalId = window.setInterval(heartbeat, heartbeatIntervalMs);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return state;
}
