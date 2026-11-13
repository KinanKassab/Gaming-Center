import { describe, expect, it } from "vitest";
import {
  elapsedDisplaySeconds,
  elapsedTimerShouldTick,
  formatElapsedClock,
  formatElapsedDisplay,
} from "@/ui/elapsed-display";

describe("BUG-030 elapsed display (presentation only)", () => {
  const startedAtMs = Date.parse("2026-08-31T00:00:00.000Z");

  it("uses the same clock for SSR and the first client representation", () => {
    const nowMs = startedAtMs + (2 * 3600 + 49 * 60 + 5) * 1000;
    const input = {
      startedAtMs,
      status: "ACTIVE",
      currentPauseStartedAtMs: null,
      nowMs,
    };
    const server = formatElapsedDisplay(input);
    const firstClient = formatElapsedDisplay({ ...input });
    expect(server).toBe("02:49:05");
    expect(firstClient).toBe(server);
  });

  it("advances only when nowMs changes after mount", () => {
    const nowMs = startedAtMs + 10_000;
    const first = formatElapsedDisplay({
      startedAtMs,
      status: "ACTIVE",
      currentPauseStartedAtMs: null,
      nowMs,
    });
    const afterTick = formatElapsedDisplay({
      startedAtMs,
      status: "ACTIVE",
      currentPauseStartedAtMs: null,
      nowMs: nowMs + 1000,
    });
    expect(first).toBe("00:00:10");
    expect(afterTick).toBe("00:00:11");
    expect(elapsedTimerShouldTick("ACTIVE")).toBe(true);
  });

  it("freezes paused sessions at the pause start even if nowMs moves", () => {
    const pauseAt = startedAtMs + 90_000;
    const later = pauseAt + 60_000;
    const frozen = formatElapsedDisplay({
      startedAtMs,
      status: "PAUSED",
      currentPauseStartedAtMs: pauseAt,
      nowMs: later,
    });
    expect(frozen).toBe("00:01:30");
    expect(elapsedTimerShouldTick("PAUSED")).toBe(false);
    expect(
      elapsedDisplaySeconds({
        startedAtMs,
        status: "PAUSED",
        currentPauseStartedAtMs: pauseAt,
        nowMs: later + 5000,
      }),
    ).toBe(90);
  });

  it("does not change billing math helpers", () => {
    expect(formatElapsedClock(5 * 60)).toBe("00:05:00");
    expect(elapsedTimerShouldTick("COMPLETED")).toBe(false);
  });
});
