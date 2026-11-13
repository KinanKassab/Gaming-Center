/**
 * Floor/session elapsed clock is presentation only.
 * Authoritative billing uses server timestamps and the billing calculator.
 *
 * SSR and the first client render must use the same `nowMs` so React hydration
 * does not mismatch. Ticking starts after mount.
 */

export function formatElapsedClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export type ElapsedDisplayInput = {
  startedAtMs: number;
  status: string;
  currentPauseStartedAtMs: number | null;
  nowMs: number;
};

/** Paused sessions freeze at the pause start. Active sessions use `nowMs`. */
export function elapsedEndMs(input: ElapsedDisplayInput): number {
  if (input.status === "PAUSED" && input.currentPauseStartedAtMs != null) {
    return input.currentPauseStartedAtMs;
  }
  return input.nowMs;
}

export function elapsedDisplaySeconds(input: ElapsedDisplayInput): number {
  const started = Number.isFinite(input.startedAtMs) ? input.startedAtMs : 0;
  const end = elapsedEndMs(input);
  return Math.max(0, Math.floor((end - started) / 1000));
}

export function formatElapsedDisplay(input: ElapsedDisplayInput): string {
  return formatElapsedClock(elapsedDisplaySeconds(input));
}

export function elapsedTimerShouldTick(status: string): boolean {
  return status === "ACTIVE";
}

export function parseInstantMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
