"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveQueueSnapshot } from "./live-queue-store";

function localDeadline(snapshot: LiveQueueSnapshot | undefined, requestStartedAt: number): number | null {
  if (snapshot?.status !== "ready" || !snapshot.offerExpiresAt || !snapshot.serverNow) return null;
  // Use server-relative time, subtracting the request duration conservatively.
  const remaining = Date.parse(snapshot.offerExpiresAt) - Date.parse(snapshot.serverNow);
  return Number.isFinite(remaining) ? requestStartedAt + Math.max(0, remaining) : requestStartedAt;
}

export function useLiveQueue(initialSnapshot?: LiveQueueSnapshot) {
  const [state, setState] = useState(() => ({
    snapshot: initialSnapshot,
    deadline: localDeadline(initialSnapshot, Date.now()),
  }));
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(false);
  const [synchronized, setSynchronized] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const request = useRef<{ controller: AbortController; id: number } | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async (method: "GET" | "POST") => {
    if (request.current && method === "GET") return;
    request.current?.controller.abort();
    const controller = new AbortController();
    const id = ++sequence.current;
    request.current = { controller, id };
    const startedAt = Date.now();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    if (method === "POST") setRejoining(true);
    try {
      const response = await fetch("/api/queue", { method, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Queue request failed");
      const snapshot = await response.json() as LiveQueueSnapshot;
      if (id !== sequence.current || controller.signal.aborted) return;
      setState((previous) => {
        let deadline = localDeadline(snapshot, startedAt);
        if (previous.snapshot?.entryId === snapshot.entryId
          && previous.snapshot?.offerExpiresAt === snapshot.offerExpiresAt
          && previous.deadline !== null && deadline !== null) {
          deadline = Math.min(previous.deadline, deadline);
        }
        return { snapshot, deadline };
      });
      setNow(Date.now());
      setError(false);
      setSynchronized(true);
    } catch {
      if (id === sequence.current) setError(true);
    } finally {
      window.clearTimeout(timeout);
      if (id === sequence.current) {
        request.current = null;
        setRejoining(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh("GET");
    const poll = window.setInterval(() => void refresh("GET"), 2_000);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      ++sequence.current;
      request.current?.controller.abort();
      request.current = null;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const remainingSeconds = state.deadline === null ? null : Math.max(0, Math.ceil((state.deadline - now) / 1_000));
  const expired = state.snapshot?.status === "expired" || remainingSeconds === 0;
  const canAccept = synchronized && !error && !expired && state.snapshot?.status === "ready" && !rejoining;
  return {
    snapshot: state.snapshot, remainingSeconds, expired, canAccept, error, rejoining,
    rejoin: () => refresh("POST"),
    // Recheck the clock on click, including after background-tab suspension.
    isAcceptCurrent: () => canAccept && (state.deadline === null || state.deadline > Date.now()),
  };
}
