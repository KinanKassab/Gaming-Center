import { MoneyError, ValidationError } from "@/core/errors";
import { billingUnitPhrase } from "@/core/duration";
import {
  currencyFractionDigits,
  formatMinorAmount,
  majorToMinor,
  parseMinorUnits,
  type MinorUnits,
} from "@/core/money";
import { TIME_BILLING_PRORATED_HOUR } from "./billing-prorated";

export const PARTIAL_PERIOD_POLICIES = ["started", "nearest", "completed"] as const;
export type PartialPeriodPolicy = (typeof PARTIAL_PERIOD_POLICIES)[number];

const POLICY_TO_ROUNDING: Record<PartialPeriodPolicy, "CEIL" | "NEAREST" | "FLOOR"> = {
  started: "CEIL",
  nearest: "NEAREST",
  completed: "FLOOR",
};

export function roundingFromPartialPeriod(policy: PartialPeriodPolicy): "CEIL" | "NEAREST" | "FLOOR" {
  return POLICY_TO_ROUNDING[policy];
}

export function partialPeriodFromRounding(mode: string): PartialPeriodPolicy {
  if (mode === "FLOOR") return "completed";
  if (mode === "NEAREST") return "nearest";
  return "started";
}

export function parseFriendlyMajor(value: string, currency: string, label: string): MinorUnits {
  try {
    return majorToMinor(value.trim(), currencyFractionDigits(currency));
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new ValidationError(`${label}: ${error.message}`);
    }
    throw error;
  }
}

export function describeTimeBasedPrice(input: {
  rateMinor: bigint | string;
  currency: string;
  billingUnitSeconds: number;
  roundingMode: string;
  timeBillingMode?: string | undefined;
}): string {
  const money = formatMinorAmount(
    typeof input.rateMinor === "string" ? parseMinorUnits(input.rateMinor) : input.rateMinor,
    input.currency,
  );
  if (input.timeBillingMode === TIME_BILLING_PRORATED_HOUR) {
    return `${money} per hour`;
  }
  const unit = billingUnitPhrase(input.billingUnitSeconds);
  if (input.roundingMode === "FLOOR") return `${money} per completed ${unit}`;
  if (input.roundingMode === "NEAREST") return `${money} per ${unit} (nearest period)`;
  return `${money} per started ${unit}`;
}

export function describePackagePrice(input: {
  packagePriceMinor: bigint | string;
  currency: string;
  packageDurationSeconds: number;
}): string {
  const money = formatMinorAmount(
    typeof input.packagePriceMinor === "string"
      ? parseMinorUnits(input.packagePriceMinor)
      : input.packagePriceMinor,
    input.currency,
  );
  return `${money} for ${billingUnitPhrase(input.packageDurationSeconds)}`;
}
