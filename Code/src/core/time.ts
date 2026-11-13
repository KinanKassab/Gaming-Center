/** Calendar day bounds in an IANA timezone, returned as UTC Date instants. */

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;

export function isValidIanaTimeZone(value: string): boolean {
  if (!IANA_TIME_ZONE_PATTERN.test(value) || value.length > 64) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function requireIanaTimeZone(value: string | null | undefined, fallback = "UTC"): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed && isValidIanaTimeZone(trimmed)) return trimmed;
  if (isValidIanaTimeZone(fallback)) return fallback;
  return "UTC";
}

function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

export function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const hour = input.hour ?? 0;
  const minute = input.minute ?? 0;
  const second = input.second ?? 0;
  const utcGuess = Date.UTC(input.year, input.month - 1, input.day, hour, minute, second);
  const first = new Date(utcGuess - offsetMsAt(new Date(utcGuess), timeZone));
  const adjusted = new Date(utcGuess - offsetMsAt(first, timeZone));
  return adjusted;
}

export function startOfDayInTimeZone(timeZone: string, now = new Date()): Date {
  try {
    const zone = requireIanaTimeZone(timeZone);
    const parts = zonedParts(now, zone);
    return zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day }, zone);
  } catch {
    const utc = new Date(now);
    utc.setUTCHours(0, 0, 0, 0);
    return utc;
  }
}

export function addCalendarDaysInTimeZone(start: Date, days: number, timeZone: string): Date {
  const zone = requireIanaTimeZone(timeZone);
  const parts = zonedParts(start, zone);
  const utcDate = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const shifted = new Date(utcDate);
  return zonedDateTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    zone,
  );
}

export function formatDateTimeLocalInTimeZone(instant: Date, timeZone: string): string {
  const zone = requireIanaTimeZone(timeZone);
  const parts = zonedParts(instant, zone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseDateTimeLocalInTimeZone(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const zone = requireIanaTimeZone(timeZone);
  return zonedDateTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] ?? "0"),
    },
    zone,
  );
}

/** Absolute ISO instants stay absolute. Naive datetime-local values use the business timezone. */
export function parseReportInstant(value: string, timeZone: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const local = parseDateTimeLocalInTimeZone(trimmed, timeZone);
  if (local) return local;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
