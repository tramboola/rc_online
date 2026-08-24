"use client";

import { useEffect, useState } from "react";

import {
  connectViewerSocket,
  type ViewerSocketStatus,
} from "./viewer-socket-client";

export type ViewerCountState = {
  count: number | null;
  status: ViewerSocketStatus;
};

export function useViewerCount(): ViewerCountState {
  const [state, setState] = useState<ViewerCountState>({
    count: null,
    status: "connecting",
  });

  useEffect(() => {
    return connectViewerSocket({
      onCount: (count) => setState((current) => ({ ...current, count })),
      onStatus: (status) => setState((current) => ({
        count: status === "live" ? current.count : null,
        status,
      })),
    });
  }, []);

  return state;
}
