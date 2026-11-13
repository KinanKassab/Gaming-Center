import { secondsToDuration } from "@/core/duration";
import type { AppLocale } from "@/i18n/locales";
import { t } from "@/i18n/t";

function unitLabel(locale: AppLocale, unit: "hour" | "minute" | "second", count: number): string {
  if (count === 1) {
    if (unit === "hour") return t(locale, "duration.hourOne");
    if (unit === "minute") return t(locale, "duration.minuteOne");
    return t(locale, "duration.secondOne");
  }
  if (count === 2) {
    if (unit === "hour") return t(locale, "duration.hourTwo");
    if (unit === "minute") return t(locale, "duration.minuteTwo");
    return t(locale, "duration.secondTwo");
  }
  if (count >= 3 && count <= 10) {
    if (unit === "hour") return t(locale, "duration.hourFew", { n: count });
    if (unit === "minute") return t(locale, "duration.minuteFew", { n: count });
    return t(locale, "duration.secondFew", { n: count });
  }
  if (unit === "hour") return t(locale, "duration.hourOther", { n: count });
  if (unit === "minute") return t(locale, "duration.minuteOther", { n: count });
  return t(locale, "duration.secondOther", { n: count });
}

/** Presentation only. Canonical stored duration remains whole seconds. */
export function formatDurationForDisplay(totalSeconds: number, locale: AppLocale): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const { hours, minutes, seconds } = secondsToDuration(safe);
  const parts: string[] = [];
  if (hours > 0) parts.push(unitLabel(locale, "hour", hours));
  if (minutes > 0) parts.push(unitLabel(locale, "minute", minutes));
  if (seconds > 0) parts.push(unitLabel(locale, "second", seconds));
  if (parts.length === 0) return t(locale, "duration.zero");
  const joiner = t(locale, "duration.join");
  return parts.join(joiner);
}
