import { currencyFractionDigits, minorToMajorString, parseMinorUnits, type MinorUnits } from "@/core/money";
import type { AppLocale } from "@/i18n/locales";

const BCP47: Record<AppLocale, string> = {
  ar: "ar",
  en: "en-GB",
};

/**
 * Display grouping only. Canonical major string (no grouping) is unchanged.
 * Latin digits so cashier amounts stay 0-9 and money input is unaffected.
 */
export function formatMinorAmountForDisplay(
  minor: MinorUnits | string,
  currency: string,
  locale: AppLocale,
): string {
  const value = typeof minor === "string" ? parseMinorUnits(minor) : minor;
  const digits = currencyFractionDigits(currency);
  const major = minorToMajorString(value, digits);
  const number = Number(major);
  const grouped = Number.isFinite(number)
    ? new Intl.NumberFormat(BCP47[locale], {
        useGrouping: true,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        numberingSystem: "latn",
      }).format(number)
    : major;
  return `${grouped} ${currency.trim().toUpperCase()}`;
}

export function formatDateTimeForDisplay(
  value: Date | string | null | undefined,
  locale: AppLocale,
  timeZone = "UTC",
): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(BCP47[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    numberingSystem: "latn",
  }).format(date);
}

export function formatIntegerForDisplay(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(BCP47[locale], {
    useGrouping: true,
    numberingSystem: "latn",
  }).format(value);
}
