import { describe, expect, it } from "vitest";
import { billingUnitPhrase, durationToSeconds, formatDurationSeconds, secondsToDuration } from "@/core/duration";

describe("duration helpers", () => {
  it("converts hours and minutes to canonical seconds", () => {
    expect(durationToSeconds(1, 30)).toBe(5400);
    expect(durationToSeconds(2, 0)).toBe(7200);
    expect(secondsToDuration(5400)).toEqual({ hours: 1, minutes: 30, seconds: 0 });
    expect(formatDurationSeconds(3600)).toBe("1 hour");
    expect(billingUnitPhrase(3600)).toBe("hour");
  });
});
