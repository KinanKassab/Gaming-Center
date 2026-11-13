import { formatDateTimeLocalInTimeZone, parseDateTimeLocalInTimeZone } from "@/core/time";

export const REPORT_RANGE_IDS = ["1h", "2h", "6h", "12h", "24h", "2d", "7d", "30d"] as const;

export type ReportRangeId = (typeof REPORT_RANGE_IDS)[number];

export const DEFAULT_REPORT_RANGE: ReportRangeId = "7d";

export const CUSTOM_REPORT_RANGE = "custom";

/** Matches `MAX_RANGE_MS` in the reports module. */
export const MAX_REPORT_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

const RANGE_MS: Record<ReportRangeId, number> = {
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export type ReportPageQuery = {
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  branchId?: string | undefined;
  status?: string | undefined;
  page?: number | undefined;
};

export function parseReportRangeId(value: string | null | undefined): ReportRangeId {
  if (value && (REPORT_RANGE_IDS as readonly string[]).includes(value)) {
    return value as ReportRangeId;
  }
  return DEFAULT_REPORT_RANGE;
}

export function reportRangeBounds(range: ReportRangeId, now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - RANGE_MS[range]), to: now };
}

export function isCustomReportRange(value: string | null | undefined): boolean {
  return value === CUSTOM_REPORT_RANGE;
}

function fallbackWindow(
  timeZone: string,
  now: Date,
): { from: Date; to: Date; fromLocal: string; toLocal: string } {
  const bounds = reportRangeBounds(DEFAULT_REPORT_RANGE, now);
  return {
    ...bounds,
    fromLocal: formatDateTimeLocalInTimeZone(bounds.from, timeZone),
    toLocal: formatDateTimeLocalInTimeZone(bounds.to, timeZone),
  };
}

function clampReportWindow(from: Date, to: Date): { from: Date; to: Date } {
  if (to.getTime() - from.getTime() <= MAX_REPORT_RANGE_MS) return { from, to };
  return { from, to: new Date(from.getTime() + MAX_REPORT_RANGE_MS) };
}

export function resolveReportWindow(input: {
  range?: string | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  timeZone: string;
  now?: Date | undefined;
}): {
  from: Date;
  to: Date;
  custom: boolean;
  rangeId: ReportRangeId | typeof CUSTOM_REPORT_RANGE;
  fromLocal: string;
  toLocal: string;
} {
  const now = input.now ?? new Date();
  if (isCustomReportRange(input.range)) {
    const parsedFrom = input.from ? parseDateTimeLocalInTimeZone(input.from, input.timeZone) : null;
    const parsedTo = input.to ? parseDateTimeLocalInTimeZone(input.to, input.timeZone) : null;
    if (parsedFrom && parsedTo && parsedTo.getTime() > parsedFrom.getTime()) {
      const { from, to } = clampReportWindow(parsedFrom, parsedTo);
      return {
        from,
        to,
        custom: true,
        rangeId: CUSTOM_REPORT_RANGE,
        fromLocal: formatDateTimeLocalInTimeZone(from, input.timeZone),
        toLocal: formatDateTimeLocalInTimeZone(to, input.timeZone),
      };
    }
    return { ...fallbackWindow(input.timeZone, now), custom: true, rangeId: CUSTOM_REPORT_RANGE };
  }
  const rangeId = parseReportRangeId(input.range);
  const bounds = reportRangeBounds(rangeId, now);
  return {
    ...bounds,
    custom: false,
    rangeId,
    fromLocal: formatDateTimeLocalInTimeZone(bounds.from, input.timeZone),
    toLocal: formatDateTimeLocalInTimeZone(bounds.to, input.timeZone),
  };
}

export function reportsPageHref(query: ReportPageQuery): string {
  const params = new URLSearchParams();
  if (isCustomReportRange(query.range)) {
    params.set("range", CUSTOM_REPORT_RANGE);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  } else {
    const range = parseReportRangeId(query.range);
    if (range !== DEFAULT_REPORT_RANGE) params.set("range", range);
  }
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.status) params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const encoded = params.toString();
  return encoded ? `/admin/reports?${encoded}` : "/admin/reports";
}
