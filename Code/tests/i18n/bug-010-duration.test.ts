import { describe, expect, it } from "vitest";
import { formatDurationSeconds } from "@/core/duration";
import { formatDurationForDisplay } from "@/i18n/duration";

describe("BUG-010 locale-aware duration display", () => {
  it("keeps the English billing formatter unchanged", () => {
    expect(formatDurationSeconds(3600)).toBe("1 hour");
    expect(formatDurationSeconds(0)).toBe("0 minutes");
  });

  it("formats representative English durations", () => {
    expect(formatDurationForDisplay(0, "en")).toBe("0 minutes");
    expect(formatDurationForDisplay(1, "en")).toBe("1 second");
    expect(formatDurationForDisplay(12, "en")).toBe("12 seconds");
    expect(formatDurationForDisplay(60, "en")).toBe("1 minute");
    expect(formatDurationForDisplay(300, "en")).toBe("5 minutes");
    expect(formatDurationForDisplay(61, "en")).toBe("1 minute 1 second");
    expect(formatDurationForDisplay(178, "en")).toBe("2 minutes 58 seconds");
    expect(formatDurationForDisplay(3600, "en")).toBe("1 hour");
  });

  it("formats representative Arabic durations", () => {
    expect(formatDurationForDisplay(0, "ar")).toBe("0 دقيقة");
    expect(formatDurationForDisplay(1, "ar")).toBe("ثانية واحدة");
    expect(formatDurationForDisplay(12, "ar")).toBe("12 ثانية");
    expect(formatDurationForDisplay(60, "ar")).toBe("دقيقة واحدة");
    expect(formatDurationForDisplay(300, "ar")).toBe("5 دقائق");
    expect(formatDurationForDisplay(61, "ar")).toBe("دقيقة واحدة و ثانية واحدة");
    expect(formatDurationForDisplay(178, "ar")).toBe("دقيقتان و 58 ثانية");
    expect(formatDurationForDisplay(3600, "ar")).toBe("ساعة واحدة");
    expect(formatDurationForDisplay(178, "ar")).not.toMatch(/minutes|seconds/i);
  });
});
