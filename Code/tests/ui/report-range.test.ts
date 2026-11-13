import { describe, expect, it } from "vitest";
import {
  CUSTOM_REPORT_RANGE,
  DEFAULT_REPORT_RANGE,
  parseReportRangeId,
  reportRangeBounds,
  reportsPageHref,
  resolveReportWindow,
} from "@/ui/report-range";

describe("report range presets", () => {
  it("defaults to last week and computes rolling windows from now", () => {
    expect(parseReportRangeId(undefined)).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRangeId("nope")).toBe("7d");
    expect(parseReportRangeId("1h")).toBe("1h");
    const now = new Date("2026-09-18T12:00:00.000Z");
    expect(reportRangeBounds("1h", now)).toEqual({
      from: new Date("2026-09-18T11:00:00.000Z"),
      to: now,
    });
    expect(reportRangeBounds("2h", now).from.toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(reportRangeBounds("6h", now).from.toISOString()).toBe("2026-09-18T06:00:00.000Z");
    expect(reportRangeBounds("12h", now).from.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(reportRangeBounds("24h", now).from.toISOString()).toBe("2026-09-17T12:00:00.000Z");
    expect(reportRangeBounds("2d", now).from.toISOString()).toBe("2026-09-16T12:00:00.000Z");
    expect(reportRangeBounds("7d", now).from.toISOString()).toBe("2026-09-11T12:00:00.000Z");
    expect(reportRangeBounds("30d", now).from.toISOString()).toBe("2026-08-19T12:00:00.000Z");
  });

  it("builds report hrefs without a standalone sessions path", () => {
    expect(reportsPageHref({})).toBe("/admin/reports");
    expect(reportsPageHref({ range: "1h", status: "ACTIVE", page: 2 })).toBe(
      "/admin/reports?range=1h&status=ACTIVE&page=2",
    );
    expect(
      reportsPageHref({
        range: CUSTOM_REPORT_RANGE,
        from: "2026-09-01T00:00",
        to: "2026-09-02T12:30",
      }),
    ).toBe("/admin/reports?range=custom&from=2026-09-01T00%3A00&to=2026-09-02T12%3A30");
  });

  it("resolves a custom window in the organization timezone and clamps long ranges", () => {
    const custom = resolveReportWindow({
      range: "custom",
      from: "2026-01-02T00:00",
      to: "2026-01-03T00:00",
      timeZone: "Asia/Riyadh",
    });
    expect(custom.custom).toBe(true);
    expect(custom.from.toISOString()).toBe("2026-01-01T21:00:00.000Z");
    expect(custom.to.toISOString()).toBe("2026-01-02T21:00:00.000Z");
    expect(custom.fromLocal).toBe("2026-01-02T00:00");
    expect(custom.toLocal).toBe("2026-01-03T00:00");

    const clamped = resolveReportWindow({
      range: "custom",
      from: "2026-01-01T00:00",
      to: "2026-04-01T00:00",
      timeZone: "UTC",
    });
    expect(clamped.to.getTime() - clamped.from.getTime()).toBe(31 * 24 * 60 * 60 * 1000);

    const invalid = resolveReportWindow({
      range: "custom",
      from: "nope",
      to: "also-nope",
      timeZone: "UTC",
      now: new Date("2026-09-18T12:00:00.000Z"),
    });
    expect(invalid.custom).toBe(true);
    expect(invalid.from.toISOString()).toBe("2026-09-11T12:00:00.000Z");
  });
});
