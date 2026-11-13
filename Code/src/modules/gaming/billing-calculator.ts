import { z } from "zod";
import { BillingError, MoneyError } from "@/core/errors";
import { addMinor, assertInt64Minor, multiplyMinor, parseMinorUnits } from "@/core/money";
import { uuidPattern } from "./normalize";
import {
  BILLING_RULE_VERSION,
  BILLING_RULE_VERSION_PRORATED,
  TIME_BILLING_PRORATED_HOUR,
  TIME_BILLING_UNIT,
  allocateTotalByWeights,
  proratedHourlyAmountFromTerms,
  roundBillableSecondsProrated,
  type TimeBillingMode,
} from "./billing-prorated";

export {
  BILLING_RULE_VERSION,
  BILLING_RULE_VERSION_PRORATED,
  TIME_BILLING_PRORATED_HOUR,
  TIME_BILLING_UNIT,
} from "./billing-prorated";

const snapshotSchema = z.object({
  assignmentId: z.string().regex(uuidPattern),
  pricingPlanId: z.string().regex(uuidPattern),
  code: z.string().min(1),
  name: z.string().min(1),
  pricingModel: z.enum(["TIME_BASED", "PACKAGE"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  rateMinor: z.string().regex(/^\d+$/).nullable(),
  billingUnitSeconds: z.number().int().positive().nullable(),
  roundingMode: z.enum(["CEIL", "NEAREST", "FLOOR"]),
  minimumBillableSeconds: z.number().int().min(0),
  minimumChargeMinor: z.string().regex(/^\d+$/),
  packageDurationSeconds: z.number().int().positive().nullable(),
  packagePriceMinor: z.string().regex(/^\d+$/).nullable(),
  capturedAt: z.string().min(1),
  timeBillingMode: z.enum(["UNIT", "PRORATED_HOUR"]).optional(),
  timeRoundMultipleSeconds: z.number().int().positive().optional(),
  minPositiveBillableSeconds: z.number().int().positive().optional(),
  hourSeconds: z.number().int().positive().optional(),
  priceRoundMultipleMinor: z.string().regex(/^\d+$/).optional(),
});

export type ParsedPricingSnapshot = z.infer<typeof snapshotSchema>;

export type BillingSegmentFact = {
  id: string;
  deviceId: string;
  pricingPlanId: string;
  startedAt: Date;
  endedAt: Date | null;
  pricingSnapshot: unknown;
  computedAmountMinor?: bigint | null;
};

export type BillingPauseFact = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  isBillable: boolean;
};

export type BillingMode = "provisional" | "final";

export type SessionBillingFacts = {
  sessionId: string;
  sessionStatus: string;
  segments: BillingSegmentFact[];
  pauses: BillingPauseFact[];
  asOf: Date;
  mode: BillingMode;
};

export type SegmentBillingLine = {
  segmentId: string;
  deviceId: string;
  pricingPlanId: string;
  startedAt: string;
  endedAt: string;
  elapsedSeconds: string;
  pausedNonBillableSeconds: string;
  pausedBillableSeconds: string;
  billableSeconds: string;
  billedDurationSeconds: string;
  billedUnits: string;
  rateMinor: string | null;
  amountMinor: string;
  minimumAppliedMinor: string;
  pricingModel: "TIME_BASED" | "PACKAGE";
  currency: string;
  roundingMode: "CEIL" | "NEAREST" | "FLOOR";
  billingUnitSeconds: number | null;
  minimumBillableSeconds: number;
  minimumChargeMinor: string;
  packageDurationSeconds: number | null;
  packagePriceMinor: string | null;
  assignmentId: string;
  planCode: string;
  planName: string;
  timeBillingMode: TimeBillingMode;
};

export type BillingResult = {
  ruleVersion: string;
  currency: string;
  totalMinor: string;
  elapsedSeconds: string;
  pausedNonBillableSeconds: string;
  pausedBillableSeconds: string;
  billableSeconds: string;
  calculatedAt: string;
  segments: SegmentBillingLine[];
};

function fail(message: string): never {
  throw new BillingError(message);
}

/** Fail-closed message when PACKAGE would be billed across more than one segment. */
export const PACKAGE_MULTI_SEGMENT_MESSAGE =
  "PACKAGE billing is not defined across more than one session segment. PACKAGE + MOVE is not supported. End the session on the same device or use a TIME_BASED plan.";

function asInstant(value: Date, label: string): bigint {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail(`${label} is not a valid timestamp`);
  }
  const ms = value.getTime();
  if (!Number.isInteger(ms)) {
    fail(`${label} is not an integer millisecond instant`);
  }
  return BigInt(ms);
}

function elapsedMs(startedAt: Date, endedAt: Date, label: string): bigint {
  const ms = asInstant(endedAt, `${label} end`) - asInstant(startedAt, `${label} start`);
  if (ms < 0n) {
    fail(`${label} ends before it starts`);
  }
  return ms;
}

function msToSecondsFloor(ms: bigint): bigint {
  return ms / 1000n;
}

function toNonNegInt(value: number, label: string): bigint {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    fail(`${label} is not a safe non-negative integer`);
  }
  return BigInt(value);
}

function overlapMs(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): bigint {
  const startA = asInstant(leftStart, "overlap left start");
  const endA = asInstant(leftEnd, "overlap left end");
  const startB = asInstant(rightStart, "overlap right start");
  const endB = asInstant(rightEnd, "overlap right end");
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  if (end <= start) return 0n;
  return end - start;
}

export function billedUnitsFromSeconds(
  durationSeconds: bigint,
  unitSeconds: bigint,
  roundingMode: "CEIL" | "NEAREST" | "FLOOR",
): bigint {
  if (unitSeconds <= 0n) fail("billing_unit_seconds must be greater than 0");
  if (durationSeconds < 0n) fail("Duration cannot be negative");
  if (roundingMode === "FLOOR") return durationSeconds / unitSeconds;
  if (roundingMode === "CEIL") {
    if (durationSeconds === 0n) return 0n;
    return (durationSeconds + unitSeconds - 1n) / unitSeconds;
  }
  // NEAREST, half away from zero / half up for non-negative integers:
  // (2n + d) / 2d
  return (2n * durationSeconds + unitSeconds) / (2n * unitSeconds);
}

export function parsePricingSnapshot(raw: unknown): ParsedPricingSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    fail("Segment pricing snapshot is missing or malformed");
  }
  const snapshot = parsed.data;
  if (snapshot.pricingModel === "TIME_BASED") {
    if (snapshot.rateMinor == null || snapshot.billingUnitSeconds == null) {
      fail("TIME_BASED snapshot requires rateMinor and billingUnitSeconds");
    }
    if (snapshot.packageDurationSeconds != null || snapshot.packagePriceMinor != null) {
      fail("TIME_BASED snapshot cannot include package fields");
    }
    if ((snapshot.timeBillingMode ?? TIME_BILLING_UNIT) === TIME_BILLING_PRORATED_HOUR) {
      if (
        snapshot.timeRoundMultipleSeconds == null ||
        snapshot.minPositiveBillableSeconds == null ||
        snapshot.hourSeconds == null ||
        snapshot.priceRoundMultipleMinor == null
      ) {
        fail("PRORATED_HOUR snapshot is missing rounding parameters");
      }
    }
  } else {
    if (snapshot.packageDurationSeconds == null || snapshot.packagePriceMinor == null) {
      fail("PACKAGE snapshot requires packageDurationSeconds and packagePriceMinor");
    }
    if (snapshot.rateMinor != null || snapshot.billingUnitSeconds != null) {
      fail("PACKAGE snapshot cannot include time-based rate fields");
    }
  }
  return snapshot;
}

function moneyFromSnapshot(value: string, label: string): bigint {
  try {
    const parsed = parseMinorUnits(value);
    assertInt64Minor(parsed, label);
    if (parsed < 0n) fail(`${label} must be non-negative`);
    return parsed;
  } catch (error) {
    if (error instanceof BillingError) throw error;
    if (error instanceof MoneyError) fail(error.message);
    fail(`${label} is not valid integer money`);
  }
}

export function calculateSegmentLine(
  segment: BillingSegmentFact,
  pauses: BillingPauseFact[],
  asOf: Date,
  mode: BillingMode,
): SegmentBillingLine {
  const endedAt = segment.endedAt ?? (mode === "provisional" ? asOf : null);
  if (!endedAt) {
    fail("Final billing requires every segment to have ended_at");
  }
  if (mode === "provisional" && segment.endedAt == null && asInstant(asOf, "asOf") < asInstant(segment.startedAt, "segment start")) {
    fail("Provisional asOf is before the segment start");
  }

  const snapshot = parsePricingSnapshot(segment.pricingSnapshot);
  if (snapshot.pricingPlanId !== segment.pricingPlanId) {
    fail("Segment pricing_plan_id does not match the captured snapshot");
  }

  const elapsed = elapsedMs(segment.startedAt, endedAt, "segment");
  let pausedNonBillableMs = 0n;
  let pausedBillableMs = 0n;

  for (const pause of pauses) {
    const pauseEnd = pause.endedAt ?? endedAt;
    const overlap = overlapMs(segment.startedAt, endedAt, pause.startedAt, pauseEnd);
    if (pause.isBillable) pausedBillableMs += overlap;
    else pausedNonBillableMs += overlap;
  }

  if (pausedNonBillableMs + pausedBillableMs > elapsed) {
    fail("Pause overlap exceeds segment elapsed time");
  }

  const billableMs = elapsed - pausedNonBillableMs;
  const elapsedSeconds = msToSecondsFloor(elapsed);
  const pausedNonBillableSeconds = msToSecondsFloor(pausedNonBillableMs);
  const pausedBillableSeconds = msToSecondsFloor(pausedBillableMs);
  const billableSeconds = msToSecondsFloor(billableMs);
  const minimumBillableSeconds = toNonNegInt(snapshot.minimumBillableSeconds, "minimumBillableSeconds");
  let billedDurationSeconds =
    billableSeconds > minimumBillableSeconds ? billableSeconds : minimumBillableSeconds;
  const minimumChargeMinor = moneyFromSnapshot(snapshot.minimumChargeMinor, "minimumChargeMinor");

  let billedUnits = 0n;
  let rawAmount = 0n;
  let rateMinor: bigint | null = null;
  let packagePriceMinor: bigint | null = null;

  const timeBillingMode: TimeBillingMode =
    snapshot.pricingModel === "TIME_BASED" && snapshot.timeBillingMode === TIME_BILLING_PRORATED_HOUR
      ? TIME_BILLING_PRORATED_HOUR
      : TIME_BILLING_UNIT;

  if (snapshot.pricingModel === "TIME_BASED") {
    rateMinor = moneyFromSnapshot(snapshot.rateMinor!, "rateMinor");
    if (timeBillingMode === TIME_BILLING_PRORATED_HOUR) {
      // Timing only. Nearest-5 rounding, the positive 5-minute minimum, and
      // money rounding run once per session in applySessionProratedHourBilling.
      billedDurationSeconds = billableSeconds;
      billedUnits = 0n;
      rawAmount = 0n;
    } else {
      const unit = toNonNegInt(snapshot.billingUnitSeconds!, "billingUnitSeconds");
      billedUnits = billedUnitsFromSeconds(billedDurationSeconds, unit, snapshot.roundingMode);
      try {
        rawAmount = multiplyMinor(rateMinor, billedUnits);
      } catch (error) {
        if (error instanceof MoneyError) fail(error.message);
        throw error;
      }
    }
  } else {
    packagePriceMinor = moneyFromSnapshot(snapshot.packagePriceMinor!, "packagePriceMinor");
    const packageDuration = toNonNegInt(snapshot.packageDurationSeconds!, "packageDurationSeconds");
    if (billableSeconds > packageDuration) {
      fail("PACKAGE overage is not defined; cannot bill beyond package_duration_seconds");
    }
    rawAmount = billableSeconds > 0n ? packagePriceMinor : 0n;
    billedUnits = billableSeconds > 0n ? 1n : 0n;
  }

  const amountMinor =
    timeBillingMode === TIME_BILLING_PRORATED_HOUR
      ? 0n
      : rawAmount > minimumChargeMinor
        ? rawAmount
        : minimumChargeMinor;
  const minimumAppliedMinor =
    timeBillingMode === TIME_BILLING_PRORATED_HOUR || amountMinor - rawAmount <= 0n
      ? 0n
      : amountMinor - rawAmount;
  try {
    assertInt64Minor(amountMinor, "segment amount");
  } catch (error) {
    if (error instanceof MoneyError) fail(error.message);
    throw error;
  }

  return {
    segmentId: segment.id,
    deviceId: segment.deviceId,
    pricingPlanId: segment.pricingPlanId,
    startedAt: segment.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedSeconds: elapsedSeconds.toString(),
    pausedNonBillableSeconds: pausedNonBillableSeconds.toString(),
    pausedBillableSeconds: pausedBillableSeconds.toString(),
    billableSeconds: billableSeconds.toString(),
    billedDurationSeconds: billedDurationSeconds.toString(),
    billedUnits: billedUnits.toString(),
    rateMinor: rateMinor == null ? null : rateMinor.toString(),
    amountMinor: amountMinor.toString(),
    minimumAppliedMinor: minimumAppliedMinor.toString(),
    pricingModel: snapshot.pricingModel,
    currency: snapshot.currency,
    roundingMode: snapshot.roundingMode,
    billingUnitSeconds: snapshot.billingUnitSeconds,
    minimumBillableSeconds: snapshot.minimumBillableSeconds,
    minimumChargeMinor: snapshot.minimumChargeMinor,
    packageDurationSeconds: snapshot.packageDurationSeconds,
    packagePriceMinor: packagePriceMinor == null ? null : packagePriceMinor.toString(),
    assignmentId: snapshot.assignmentId,
    planCode: snapshot.code,
    planName: snapshot.name,
    timeBillingMode,
  };
}

/**
 * PRORATED_HOUR customer charge is computed from canonical session billable
 * duration once (nearest 5 minutes, positive 5-minute minimum, nearest 5
 * currency units). MOVE must not multiply the minimum. Segment rows keep
 * timing and receive an allocation that sums to the session total.
 */
function applySessionProratedHourBilling(
  segments: BillingSegmentFact[],
  lines: SegmentBillingLine[],
): SegmentBillingLine[] {
  const proratedIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.timeBillingMode === TIME_BILLING_PRORATED_HOUR) {
      proratedIndexes.push(index);
    }
  }
  if (proratedIndexes.length === 0) return lines;

  const params = proratedIndexes.map((index) => {
    const snapshot = parsePricingSnapshot(segments[index]!.pricingSnapshot);
    return {
      timeRound: toNonNegInt(snapshot.timeRoundMultipleSeconds!, "timeRoundMultipleSeconds"),
      minPositive: toNonNegInt(snapshot.minPositiveBillableSeconds!, "minPositiveBillableSeconds"),
      hourSeconds: toNonNegInt(snapshot.hourSeconds!, "hourSeconds"),
      priceRound: moneyFromSnapshot(snapshot.priceRoundMultipleMinor!, "priceRoundMultipleMinor"),
      rateMinor: moneyFromSnapshot(snapshot.rateMinor!, "rateMinor"),
      minCharge: moneyFromSnapshot(snapshot.minimumChargeMinor, "minimumChargeMinor"),
    };
  });
  const first = params[0]!;
  for (const row of params) {
    if (
      row.timeRound !== first.timeRound ||
      row.minPositive !== first.minPositive ||
      row.hourSeconds !== first.hourSeconds ||
      row.priceRound !== first.priceRound
    ) {
      fail("PRORATED_HOUR session segments have mismatched rounding parameters");
    }
  }

  const weights = proratedIndexes.map((index) => BigInt(lines[index]!.billableSeconds));
  const sessionBillable = weights.reduce((sum, value) => sum + value, 0n);
  const roundedSeconds = roundBillableSecondsProrated({
    billableSeconds: sessionBillable,
    timeRoundMultipleSeconds: first.timeRound,
    minPositiveSeconds: first.minPositive,
  });
  const allocatedSeconds = allocateTotalByWeights(weights, roundedSeconds);
  let rawAmount = 0n;
  try {
    rawAmount = proratedHourlyAmountFromTerms({
      terms: params.map((row, index) => ({
        hourlyRateMinor: row.rateMinor,
        seconds: allocatedSeconds[index]!,
      })),
      hourSeconds: first.hourSeconds,
      priceRoundMultipleMinor: first.priceRound,
    });
  } catch (error) {
    if (error instanceof MoneyError) fail(error.message);
    throw error;
  }
  let sessionMinCharge = 0n;
  for (const row of params) {
    if (row.minCharge > sessionMinCharge) sessionMinCharge = row.minCharge;
  }
  const amountMinor = rawAmount > sessionMinCharge ? rawAmount : sessionMinCharge;
  try {
    assertInt64Minor(amountMinor, "session amount");
  } catch (error) {
    if (error instanceof MoneyError) fail(error.message);
    throw error;
  }
  const minimumAppliedMinor = amountMinor - rawAmount > 0n ? amountMinor - rawAmount : 0n;
  const allocatedMoney = allocateTotalByWeights(allocatedSeconds, amountMinor);

  const next = [...lines];
  for (let offset = 0; offset < proratedIndexes.length; offset += 1) {
    const index = proratedIndexes[offset]!;
    const billedDuration = allocatedSeconds[offset]!;
    const billedUnits = first.timeRound === 0n ? 0n : billedDuration / first.timeRound;
    const lineAmount = allocatedMoney[offset]!;
    try {
      assertInt64Minor(lineAmount, "segment amount");
    } catch (error) {
      if (error instanceof MoneyError) fail(error.message);
      throw error;
    }
    next[index] = {
      ...next[index]!,
      billedDurationSeconds: billedDuration.toString(),
      billedUnits: billedUnits.toString(),
      amountMinor: lineAmount.toString(),
      minimumAppliedMinor: offset === proratedIndexes.length - 1 ? minimumAppliedMinor.toString() : "0",
    };
  }
  return next;
}

export function calculateSessionBilling(facts: SessionBillingFacts): BillingResult {
  if (facts.segments.length === 0) {
    fail("Session has no segments to bill");
  }

  const ordered = [...facts.segments].sort((left, right) => {
    const startDelta = left.startedAt.getTime() - right.startedAt.getTime();
    if (startDelta !== 0) return startDelta;
    return left.id < right.id ? -1 : 1;
  });

  if (facts.mode === "final") {
    for (const segment of ordered) {
      if (segment.endedAt == null) fail("Final billing requires every segment to have ended_at");
    }
    for (const pause of facts.pauses) {
      if (pause.endedAt == null) fail("Final billing cannot run while a pause is still open");
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const previousEnd = previous.endedAt ?? facts.asOf;
    if (current.startedAt.getTime() < previousEnd.getTime()) {
      fail("Session segments overlap");
    }
  }

  const rawLines = ordered.map((segment) =>
    calculateSegmentLine(segment, facts.pauses, facts.asOf, facts.mode),
  );

  if (rawLines.length > 1 && rawLines.some((line) => line.pricingModel === "PACKAGE")) {
    fail(PACKAGE_MULTI_SEGMENT_MESSAGE);
  }

  const currency = rawLines[0]!.currency;
  for (const line of rawLines) {
    if (line.currency !== currency) {
      fail("Session segments use mismatched currencies");
    }
  }

  const lines = applySessionProratedHourBilling(ordered, rawLines);

  let total = 0n;
  let elapsedSeconds = 0n;
  let pausedNonBillableSeconds = 0n;
  let pausedBillableSeconds = 0n;
  let billableSeconds = 0n;
  for (const line of lines) {
    try {
      total = addMinor(total, parseMinorUnits(line.amountMinor));
    } catch (error) {
      if (error instanceof MoneyError) fail(error.message);
      throw error;
    }
    elapsedSeconds += BigInt(line.elapsedSeconds);
    pausedNonBillableSeconds += BigInt(line.pausedNonBillableSeconds);
    pausedBillableSeconds += BigInt(line.pausedBillableSeconds);
    billableSeconds += BigInt(line.billableSeconds);
  }

  const usedProrated = lines.some((line) => line.timeBillingMode === TIME_BILLING_PRORATED_HOUR);
  return {
    ruleVersion: usedProrated ? BILLING_RULE_VERSION_PRORATED : BILLING_RULE_VERSION,
    currency,
    totalMinor: total.toString(),
    elapsedSeconds: elapsedSeconds.toString(),
    pausedNonBillableSeconds: pausedNonBillableSeconds.toString(),
    pausedBillableSeconds: pausedBillableSeconds.toString(),
    billableSeconds: billableSeconds.toString(),
    calculatedAt: facts.asOf.toISOString(),
    segments: lines,
  };
}
