import { BillingError, MoneyError } from "@/core/errors";
import { assertInt64Minor, type MinorUnits } from "@/core/money";

/** Finalized UNIT (CEIL/FLOOR/NEAREST per billing_unit_seconds) bills. */
export const BILLING_RULE_VERSION = "gaming.billing.v1";
/** Finalized PRORATED_HOUR bills. */
export const BILLING_RULE_VERSION_PRORATED = "gaming.billing.v2";

export const TIME_BILLING_UNIT = "UNIT";
export const TIME_BILLING_PRORATED_HOUR = "PRORATED_HOUR";
export type TimeBillingMode = typeof TIME_BILLING_UNIT | typeof TIME_BILLING_PRORATED_HOUR;

/** Captured onto new PRORATED_HOUR snapshots at session start. */
export const PRORATED_TIME_ROUND_SECONDS = 300;
export const PRORATED_MIN_POSITIVE_SECONDS = 300;
export const PRORATED_HOUR_SECONDS = 3600;
export const PRORATED_PRICE_ROUND_MINOR = 5n;

export const PRORATED_SNAPSHOT_FIELDS = {
  timeBillingMode: TIME_BILLING_PRORATED_HOUR,
  timeRoundMultipleSeconds: PRORATED_TIME_ROUND_SECONDS,
  minPositiveBillableSeconds: PRORATED_MIN_POSITIVE_SECONDS,
  hourSeconds: PRORATED_HOUR_SECONDS,
  priceRoundMultipleMinor: PRORATED_PRICE_ROUND_MINOR.toString(),
} as const;

function fail(message: string): never {
  throw new BillingError(message);
}

/**
 * Nearest multiple, HALF-UP / away from zero, non-negative bigint only.
 * units = (2n + m) / (2m); result = units * m. No floating-point.
 */
export function roundToMultipleHalfUp(value: bigint, multiple: bigint): bigint {
  if (multiple <= 0n) fail("Rounding multiple must be greater than 0");
  if (value < 0n) fail("Duration cannot be negative");
  const units = (2n * value + multiple) / (2n * multiple);
  return units * multiple;
}

/** Positive billable time never rounds to free; exactly 0 stays 0. */
export function applyMinPositiveDuration(
  billableSeconds: bigint,
  roundedSeconds: bigint,
  minPositiveSeconds: bigint,
): bigint {
  if (billableSeconds < 0n || roundedSeconds < 0n || minPositiveSeconds <= 0n) {
    fail("Minimum positive duration is invalid");
  }
  if (billableSeconds > 0n && roundedSeconds === 0n) return minPositiveSeconds;
  return roundedSeconds;
}

export function roundBillableSecondsProrated(input: {
  billableSeconds: bigint;
  timeRoundMultipleSeconds: bigint;
  minPositiveSeconds: bigint;
}): bigint {
  const rounded = roundToMultipleHalfUp(input.billableSeconds, input.timeRoundMultipleSeconds);
  return applyMinPositiveDuration(input.billableSeconds, rounded, input.minPositiveSeconds);
}

/**
 * Split `total` across `weights` with floor + largest remainder so the parts
 * sum exactly to `total`. When every weight is 0 and `total` is positive, the
 * entire total is assigned to the last bucket (session minimum charge on a
 * zero-duration session).
 */
export function allocateTotalByWeights(weights: readonly bigint[], total: bigint): bigint[] {
  if (total < 0n) fail("Allocation total cannot be negative");
  if (weights.some((weight) => weight < 0n)) fail("Allocation weights cannot be negative");
  if (weights.length === 0) {
    if (total === 0n) return [];
    fail("Cannot allocate a positive total across no buckets");
  }
  if (total === 0n) return weights.map(() => 0n);

  const sumWeights = weights.reduce((sum, weight) => sum + weight, 0n);
  if (sumWeights === 0n) {
    const parts = weights.map(() => 0n);
    parts[parts.length - 1] = total;
    return parts;
  }

  const parts = weights.map((weight) => (weight * total) / sumWeights);
  let remainder = total - parts.reduce((sum, part) => sum + part, 0n);
  const order = weights
    .map((weight, index) => ({ index, rem: (weight * total) % sumWeights }))
    .sort((left, right) => {
      if (left.rem === right.rem) return left.index - right.index;
      return left.rem > right.rem ? -1 : 1;
    });
  for (const { index } of order) {
    if (remainder === 0n) break;
    parts[index] = parts[index]! + 1n;
    remainder -= 1n;
  }
  return parts;
}

/**
 * raw = sum(hourlyRate_i × seconds_i) / hourSeconds, then nearest `priceRoundMultiple` HALF-UP.
 * Single-rate sessions pass one term whose seconds are the session-rounded duration.
 */
export function proratedHourlyAmountFromTerms(input: {
  terms: ReadonlyArray<{ hourlyRateMinor: MinorUnits; seconds: bigint }>;
  hourSeconds: bigint;
  priceRoundMultipleMinor: bigint;
}): MinorUnits {
  if (input.hourSeconds <= 0n) fail("Hour length must be greater than 0");
  if (input.priceRoundMultipleMinor <= 0n) fail("Price rounding multiple must be greater than 0");

  let numerator = 0n;
  for (const term of input.terms) {
    if (term.hourlyRateMinor < 0n) fail("Hourly rate cannot be negative");
    if (term.seconds < 0n) fail("Duration cannot be negative");
    numerator += term.hourlyRateMinor * term.seconds;
  }
  if (numerator === 0n) return 0n;

  const denominator = input.hourSeconds * input.priceRoundMultipleMinor;
  const units = (2n * numerator + denominator) / (2n * denominator);
  const amount = units * input.priceRoundMultipleMinor;
  try {
    return assertInt64Minor(amount, "prorated amount");
  } catch (error) {
    if (error instanceof MoneyError) fail(error.message);
    throw error;
  }
}

/**
 * raw = hourlyRate × roundedSeconds / hourSeconds, then nearest `priceRoundMultiple` HALF-UP.
 * Rational form: units = (2n + d) / (2d) with n = rate × roundedSeconds, d = hourSeconds × priceRound;
 * amount = units × priceRound. Intermediate products stay bigint; only the final amount is int64-checked.
 */
export function proratedHourlyAmountMinor(input: {
  hourlyRateMinor: MinorUnits;
  roundedSeconds: bigint;
  hourSeconds: bigint;
  priceRoundMultipleMinor: bigint;
}): MinorUnits {
  return proratedHourlyAmountFromTerms({
    terms: [{ hourlyRateMinor: input.hourlyRateMinor, seconds: input.roundedSeconds }],
    hourSeconds: input.hourSeconds,
    priceRoundMultipleMinor: input.priceRoundMultipleMinor,
  });
}
