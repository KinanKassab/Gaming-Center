import { describe, expect, it } from "vitest";
import {
  addCalendarDaysInTimeZone,
  formatDateTimeLocalInTimeZone,
  parseDateTimeLocalInTimeZone,
  parseReportInstant,
  startOfDayInTimeZone,
} from "@/core/time";

describe("BUG-018 organization business-day boundaries", () => {
  it("treats 21:30 UTC on 1 Jan 2026 as 00:30 on 2 Jan in Asia/Riyadh", () => {
    const instant = new Date("2026-01-01T21:30:00.000Z");
    expect(formatDateTimeLocalInTimeZone(instant, "Asia/Riyadh")).toBe("2026-01-02T00:30");
    const start = startOfDayInTimeZone("Asia/Riyadh", instant);
    expect(start.toISOString()).toBe("2026-01-01T21:00:00.000Z");
    expect(addCalendarDaysInTimeZone(start, 1, "Asia/Riyadh").toISOString()).toBe("2026-01-02T21:00:00.000Z");
  });

  it("parses naive report datetime-local values in the organization timezone", () => {
    expect(parseDateTimeLocalInTimeZone("2026-01-02T00:00", "Asia/Riyadh")?.toISOString()).toBe(
      "2026-01-01T21:00:00.000Z",
    );
    const absolute = parseReportInstant("2026-01-01T21:30:00.000Z", "Asia/Riyadh");
    expect(absolute?.toISOString()).toBe("2026-01-01T21:30:00.000Z");
  });

  it("keeps dashboard billed-today bounds aligned with the same business day helper", () => {
    const now = new Date("2026-01-01T21:30:00.000Z");
    const from = startOfDayInTimeZone("Asia/Riyadh", now);
    const to = addCalendarDaysInTimeZone(from, 1, "Asia/Riyadh");
    expect(from.getTime() <= now.getTime()).toBe(true);
    expect(now.getTime() < to.getTime()).toBe(true);
  });
});
