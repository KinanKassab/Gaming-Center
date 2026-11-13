import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { ConflictError } from "@/core/errors";
import { gamingDevices, gamingPricingAssignments, gamingPricingPlans } from "@/db/schema";
import type { AppDatabase } from "@/db/tenant";
import { isPositiveHourlyRate } from "@/ui/hall-hourly-price";
import { minorToJson } from "./normalize";
import { PRORATED_SNAPSHOT_FIELDS, TIME_BILLING_PRORATED_HOUR } from "./billing-prorated";

/**
 * Deterministic assignment precedence for a device at an instant.
 * Device > Area > Device type > Branch > Organization.
 * Same rank: higher `priority`, then later `valid_from`, then later id.
 * Captures an immutable snapshot. Does not calculate a charge.
 */
const SCOPE_RANK: Record<string, number> = {
  DEVICE: 50,
  AREA: 40,
  DEVICE_TYPE: 30,
  BRANCH: 20,
  ORGANIZATION: 10,
};

export type PricingSnapshot = {
  assignmentId: string;
  pricingPlanId: string;
  code: string;
  name: string;
  pricingModel: string;
  currency: string;
  rateMinor: string | null;
  billingUnitSeconds: number | null;
  roundingMode: string;
  minimumBillableSeconds: number;
  minimumChargeMinor: string;
  packageDurationSeconds: number | null;
  packagePriceMinor: string | null;
  capturedAt: string;
  timeBillingMode?: string;
  timeRoundMultipleSeconds?: number;
  minPositiveBillableSeconds?: number;
  hourSeconds?: number;
  priceRoundMultipleMinor?: string;
};

export type ResolvedPricing = {
  pricingPlanId: string;
  snapshot: PricingSnapshot;
};

type DeviceRow = Pick<
  typeof gamingDevices.$inferSelect,
  "id" | "organizationId" | "branchId" | "areaId" | "deviceTypeId"
>;

export async function resolveDevicePricing(
  tx: AppDatabase,
  device: DeviceRow,
  at: Date,
): Promise<ResolvedPricing> {
  const rows = await loadActiveAssignments(tx, device.organizationId, at);
  const matches = rows.filter(({ assignment }) => assignmentMatchesDevice(assignment, device));
  matches.sort(compareAssignments);

  const winner = matches[0];
  if (!winner) {
    throw new ConflictError("No pricing plan is assigned for this device");
  }

  const { assignment, plan } = winner;
  const capturedAt = at.toISOString();
  const prorated = plan.timeBillingMode === TIME_BILLING_PRORATED_HOUR;
  return {
    pricingPlanId: plan.id,
    snapshot: {
      assignmentId: assignment.id,
      pricingPlanId: plan.id,
      code: plan.code,
      name: plan.name,
      pricingModel: plan.pricingModel,
      currency: plan.currency,
      rateMinor: minorToJson(plan.rateMinor),
      billingUnitSeconds: plan.billingUnitSeconds,
      roundingMode: plan.roundingMode,
      minimumBillableSeconds: plan.minimumBillableSeconds,
      minimumChargeMinor: plan.minimumChargeMinor.toString(),
      packageDurationSeconds: plan.packageDurationSeconds,
      packagePriceMinor: minorToJson(plan.packagePriceMinor),
      capturedAt,
      timeBillingMode: prorated ? TIME_BILLING_PRORATED_HOUR : "UNIT",
      ...(prorated ? PRORATED_SNAPSHOT_FIELDS : {}),
    },
  };
}

type PricedAssignment = {
  assignment: typeof gamingPricingAssignments.$inferSelect;
  plan: typeof gamingPricingPlans.$inferSelect;
};

/**
 * Positive hourly rate resolved for each device, in minor units.
 * Offers and zero or missing hourly rates do not qualify a station for the hall.
 * Precedence matches session pricing: device, area, type, branch, organization.
 */
export async function positiveHourlyRatesByDevice(
  tx: AppDatabase,
  organizationId: string,
  devices: readonly DeviceRow[],
  at: Date,
): Promise<Map<string, bigint>> {
  const rates = new Map<string, bigint>();
  if (devices.length === 0) return rates;
  const rows = await loadActiveAssignments(tx, organizationId, at);

  for (const device of devices) {
    const matches = rows.filter(
      ({ assignment, plan }) =>
        plan.pricingModel === "TIME_BASED" &&
        isPositiveHourlyRate(plan.rateMinor) &&
        assignmentMatchesDevice(assignment, device),
    );
    matches.sort(compareAssignments);
    const winner = matches[0];
    if (winner?.plan.rateMinor != null && winner.plan.rateMinor > 0n) {
      rates.set(device.id, winner.plan.rateMinor);
    }
  }
  return rates;
}

/** Device ids that resolve a positive fixed hourly price. */
export async function deviceIdsWithResolvedPrice(
  tx: AppDatabase,
  organizationId: string,
  devices: readonly DeviceRow[],
  at: Date,
): Promise<Set<string>> {
  const rates = await positiveHourlyRatesByDevice(tx, organizationId, devices, at);
  return new Set(rates.keys());
}

async function loadActiveAssignments(
  tx: AppDatabase,
  organizationId: string,
  at: Date,
): Promise<PricedAssignment[]> {
  return tx
    .select({
      assignment: gamingPricingAssignments,
      plan: gamingPricingPlans,
    })
    .from(gamingPricingAssignments)
    .innerJoin(
      gamingPricingPlans,
      and(
        eq(gamingPricingPlans.id, gamingPricingAssignments.pricingPlanId),
        eq(gamingPricingPlans.organizationId, gamingPricingAssignments.organizationId),
      ),
    )
    .where(
      and(
        eq(gamingPricingAssignments.organizationId, organizationId),
        eq(gamingPricingAssignments.status, "ACTIVE"),
        eq(gamingPricingPlans.status, "ACTIVE"),
        lte(gamingPricingAssignments.validFrom, at),
        or(isNull(gamingPricingAssignments.validTo), gt(gamingPricingAssignments.validTo, at)),
      ),
    );
}

function compareAssignments(left: PricedAssignment, right: PricedAssignment): number {
  const rankDelta =
    (SCOPE_RANK[right.assignment.scopeType] ?? 0) - (SCOPE_RANK[left.assignment.scopeType] ?? 0);
  if (rankDelta !== 0) return rankDelta;
  const leftHourly = left.plan.pricingModel === "TIME_BASED" ? 1 : 0;
  const rightHourly = right.plan.pricingModel === "TIME_BASED" ? 1 : 0;
  if (leftHourly !== rightHourly) return rightHourly - leftHourly;
  if (right.assignment.priority !== left.assignment.priority) {
    return right.assignment.priority - left.assignment.priority;
  }
  const fromDelta = right.assignment.validFrom.getTime() - left.assignment.validFrom.getTime();
  if (fromDelta !== 0) return fromDelta;
  return right.assignment.id < left.assignment.id ? -1 : 1;
}

function assignmentMatchesDevice(
  assignment: typeof gamingPricingAssignments.$inferSelect,
  device: DeviceRow,
): boolean {
  switch (assignment.scopeType) {
    case "DEVICE":
      return assignment.scopeId === device.id && assignment.branchId === device.branchId;
    case "AREA":
      return assignment.scopeId === device.areaId && assignment.branchId === device.branchId;
    case "DEVICE_TYPE":
      return assignment.scopeId === device.deviceTypeId && assignment.branchId == null;
    case "BRANCH":
      return assignment.scopeId === device.branchId && assignment.branchId === device.branchId;
    case "ORGANIZATION":
      return assignment.scopeId === device.organizationId && assignment.branchId == null;
    default:
      return false;
  }
}
