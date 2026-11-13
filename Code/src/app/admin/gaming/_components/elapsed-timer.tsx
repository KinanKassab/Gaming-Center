"use client";

import { useEffect, useState } from "react";
import {
  elapsedTimerShouldTick,
  formatElapsedDisplay,
  parseInstantMs,
} from "@/ui/elapsed-display";

/**
 * Display-only timer. Authoritative timing lives on the server timestamps.
 * `initialNowMs` must come from the server render so the first client paint matches SSR.
 */
export function ElapsedTimer(props: {
  startedAt: string;
  status: string;
  currentPauseStartedAt: string | null;
  initialNowMs: number;
}) {
  const [nowMs, setNowMs] = useState(props.initialNowMs);

  useEffect(() => {
    if (!elapsedTimerShouldTick(props.status)) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [props.status]);

  const startedAtMs = parseInstantMs(props.startedAt) ?? 0;
  const currentPauseStartedAtMs = parseInstantMs(props.currentPauseStartedAt);

  return (
    <span className="elapsed">
      {formatElapsedDisplay({
        startedAtMs,
        status: props.status,
        currentPauseStartedAtMs,
        nowMs,
      })}
    </span>
  );
}
