import { MoneyError } from "@/core/errors";

export type MinorUnits = bigint;

const INTEGER_RE = /^-?\d+$/;

export function parseMinorUnits(value: string): MinorUnits {
  if (!INTEGER_RE.test(value)) {
    throw new MoneyError("Money minor units must be an integer string");
  }
  return BigInt(value);
}

/**
 * Convert a major-unit decimal string (e.g. "10.50" or "10,000") to minor units.
 * Uses integer math only. `fractionDigits` is the ISO 4217 exponent.
 * Grouping commas/spaces are stripped; `.` remains the decimal separator.
 */
export function normalizeMajorInput(major: string): string {
  return major.trim().replace(/,/g, "").replace(/\s/g, "");
}

export function majorToMinor(major: string, fractionDigits: number): MinorUnits {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new MoneyError("Invalid currency fraction digits");
  }
  const trimmed = normalizeMajorInput(major);
  const sign = trimmed.startsWith("-") ? -1n : 1n;
  const unsigned = trimmed.replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new MoneyError("Invalid major-unit amount");
  }
  const [wholeRaw, fracRaw = ""] = unsigned.split(".");
  if (fracRaw.length > fractionDigits) {
    throw new MoneyError("Too many fraction digits for this currency");
  }
  const fracPadded = fracRaw.padEnd(fractionDigits, "0");
  const combined = `${wholeRaw}${fracPadded}` || "0";
  return sign * BigInt(combined);
}

/** PostgreSQL `bigint` range. Persisted money must fit. */
export const INT64_MAX = 9223372036854775807n;
export const INT64_MIN = -9223372036854775808n;

export function addMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertInt64Minor(a + b);
}

export function subtractMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertInt64Minor(a - b);
}

export function multiplyMinor(amount: MinorUnits, factor: bigint): MinorUnits {
  if (factor < 0n) {
    throw new MoneyError("Multiplication factor must be non-negative");
  }
  return assertInt64Minor(amount * factor);
}

export function assertNonNegativeMinor(value: MinorUnits): void {
  if (value < 0n) {
    throw new MoneyError("Amount must be non-negative");
  }
}

export function assertInt64Minor(value: MinorUnits, label = "Amount"): MinorUnits {
  if (value > INT64_MAX || value < INT64_MIN) {
    throw new MoneyError(`${label} exceeds int64 storage`);
  }
  return value;
}

/**
 * Display / input exponent for converting major units.
 *
 * SYP uses 0 because existing tests and cashier entry treat the stored integer
 * as whole pounds (`majorToMinor("15000", 0)`). Official ISO 4217 subunits for
 * SYP remain NEEDS DECISION (ADR 0005). Unknown ISO codes default to 0 so the
 * UI does not invent decimals the database never had.
 */
const FRACTION_DIGITS: Record<string, number> = {
  SYP: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export function currencyFractionDigits(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyError("Currency must be a 3-letter ISO code");
  }
  return FRACTION_DIGITS[code] ?? 0;
}

export function minorToMajorString(minor: MinorUnits, fractionDigits: number): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new MoneyError("Invalid currency fraction digits");
  }
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (fractionDigits === 0) {
    return `${negative ? "-" : ""}${abs.toString()}`;
  }
  const scale = 10n ** BigInt(fractionDigits);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(fractionDigits, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

function groupMajorString(major: string): string {
  const sign = major.startsWith("-") ? "-" : "";
  const unsigned = major.replace(/^-/, "");
  const [whole = "0", fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction != null && fraction.length > 0 ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

export function formatMinorAmount(minor: MinorUnits | string, currency: string): string {
  const value = typeof minor === "string" ? parseMinorUnits(minor) : minor;
  const digits = currencyFractionDigits(currency);
  return `${groupMajorString(minorToMajorString(value, digits))} ${currency.trim().toUpperCase()}`;
}
