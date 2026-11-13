import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import {
  coreOrganizations,
  gamingDeviceTypes,
  gamingDevices,
  gamingPricingAssignments,
  gamingPricingPlans,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "./access";
import { TIME_BILLING_PRORATED_HOUR, TIME_BILLING_UNIT } from "./billing-prorated";
import { BULK_DEVICE_MAX_COUNT } from "./device-names-limit";
import { minorToJson, normalizeRequiredName, uuidPattern } from "./normalize";
import { parseFriendlyMajor } from "./pricing-adapter";
import type { PricingAssignmentRecord } from "./pricing-assignments";
import { uniqueDeviceIds } from "./pricing-device-summary";
import type { PricingPlanRecord } from "./pricing-plans";

export const DEVICE_PRICING_KINDS = ["HOURLY", "OFFER"] as const;
export type DevicePricingKind = (typeof DEVICE_PRICING_KINDS)[number];

/** Offers stay assigned but lose to hourly at the same device scope. */
const OFFER_ASSIGNMENT_PRIORITY = -10;

const majorInput = z.string().trim().min(1).max(32);

export const createDevicePricingInputSchema = z.object({
  kind: z.enum(DEVICE_PRICING_KINDS),
  deviceIds: z.array(z.string().regex(uuidPattern, "Invalid device id")).max(BULK_DEVICE_MAX_COUNT).optional(),
  deviceTypeIds: z
    .array(z.string().regex(uuidPattern, "Invalid device type id"))
    .max(BULK_DEVICE_MAX_COUNT)
    .optional(),
  name: z.string().min(1).max(200).optional(),
  priceMajor: majorInput,
  minimumChargeMajor: majorInput.optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
});

export type CreateDevicePricingInput = z.infer<typeof createDevicePricingInputSchema>;

export type DevicePricingResult = {
  plan: PricingPlanRecord;
  assignments: PricingAssignmentRecord[];
};

type PricingTarget = {
  scopeType: "DEVICE" | "DEVICE_TYPE";
  scopeId: string;
  branchId: string | null;
  displayName: string;
};

function snapshotPlan(row: PricingPlanRecord) {
  return {
    code: row.code,
    name: row.name,
    pricingModel: row.pricingModel,
    currency: row.currency,
    rateMinor: minorToJson(row.rateMinor),
    billingUnitSeconds: row.billingUnitSeconds,
    roundingMode: row.roundingMode,
    minimumBillableSeconds: row.minimumBillableSeconds,
    minimumChargeMinor: row.minimumChargeMinor.toString(),
    packageDurationSeconds: row.packageDurationSeconds,
    packagePriceMinor: minorToJson(row.packagePriceMinor),
    timeBillingMode: row.timeBillingMode,
    status: row.status,
  };
}

function snapshotAssignment(row: PricingAssignmentRecord) {
  return {
    pricingPlanId: row.pricingPlanId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    branchId: row.branchId,
    priority: row.priority,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : null,
    status: row.status,
  };
}

export async function createDevicePricing(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateDevicePricingInput,
): Promise<DevicePricingResult> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const deviceIds = uniqueDeviceIds(input.deviceIds ?? []);
  const deviceTypeIds = uniqueDeviceIds(input.deviceTypeIds ?? []);
  if (deviceIds.length > 0 && deviceTypeIds.length > 0) {
    throw new ValidationError("Provide devices or device types, not both", "device_required");
  }
  const usingTypes = deviceTypeIds.length > 0;
  if (!usingTypes && deviceIds.length === 0) {
    throw new ValidationError("Select a device", "device_required");
  }
  const targetCount = usingTypes ? deviceTypeIds.length : deviceIds.length;
  if (input.kind === "HOURLY" && targetCount !== 1) {
    throw new ValidationError(
      usingTypes ? "Hourly price applies to one device type" : "Hourly price applies to one device",
      usingTypes ? "device_type_required" : "device_required",
    );
  }
  if (input.kind === "OFFER") {
    if (!input.name?.trim()) {
      throw new ValidationError("Offer name is required", "offer_needs_name");
    }
    if (!input.durationSeconds) {
      throw new ValidationError("Offer duration is required", "offer_needs_duration");
    }
  }

  const planId = createId();
  return insertWithAllocatedCode({
    explicit: undefined,
    prefix: "P-",
    label: "Pricing plan code",
    conflictMessage: "Pricing plan code is already in use in this organization",
    isUniqueViolation,
    insert: async (code) =>
      withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
        const orgRows = await tx
          .select({ defaultCurrency: coreOrganizations.defaultCurrency })
          .from(coreOrganizations)
          .where(eq(coreOrganizations.id, actor.organizationId))
          .limit(1);
        const currency = orgRows[0]?.defaultCurrency;
        if (!currency) throw new ValidationError("Currency is required");

        let targets: PricingTarget[];
        if (usingTypes) {
          const typeRows = await tx
            .select()
            .from(gamingDeviceTypes)
            .where(
              and(
                eq(gamingDeviceTypes.organizationId, actor.organizationId),
                inArray(gamingDeviceTypes.id, deviceTypeIds),
              ),
            );
          const byId = new Map(typeRows.map((row) => [row.id, row]));
          targets = deviceTypeIds.map((id) => {
            const row = byId.get(id);
            if (!row) throw new NotFoundError("Device type not found");
            if (row.status === "ARCHIVED") throw new ConflictError("Device type is archived");
            return {
              scopeType: "DEVICE_TYPE" as const,
              scopeId: row.id,
              branchId: null,
              displayName: row.name,
            };
          });
        } else {
          const deviceRows = await tx
            .select()
            .from(gamingDevices)
            .where(
              and(eq(gamingDevices.organizationId, actor.organizationId), inArray(gamingDevices.id, deviceIds)),
            );
          const byId = new Map(deviceRows.map((row) => [row.id, row]));
          targets = deviceIds.map((id) => {
            const row = byId.get(id);
            if (!row) throw new NotFoundError("Device not found");
            if (row.archivedAt) throw new ConflictError("Device is archived");
            requireBranchAccess(actor, row.branchId, "MANAGE");
            return {
              scopeType: "DEVICE" as const,
              scopeId: row.id,
              branchId: row.branchId,
              displayName: row.name,
            };
          });
        }

        if (input.kind === "HOURLY") {
          const target = targets[0]!;
          const existing = await tx
            .select({ id: gamingPricingAssignments.id })
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
                eq(gamingPricingAssignments.organizationId, actor.organizationId),
                eq(gamingPricingAssignments.status, "ACTIVE"),
                eq(gamingPricingAssignments.scopeType, target.scopeType),
                eq(gamingPricingAssignments.scopeId, target.scopeId),
                eq(gamingPricingPlans.status, "ACTIVE"),
                eq(gamingPricingPlans.pricingModel, "TIME_BASED"),
              ),
            )
            .limit(1);
          if (existing[0]) {
            throw new ConflictError(
              usingTypes ? "This device type already has an hourly price" : "This device already has an hourly price",
              usingTypes ? "device_type_hourly_exists" : "device_hourly_exists",
            );
          }
        }

        const name =
          input.kind === "HOURLY"
            ? normalizeRequiredName(targets[0]!.displayName)
            : normalizeRequiredName(input.name ?? "");
        const priceMinor = parseFriendlyMajor(
          input.priceMajor,
          currency,
          input.kind === "HOURLY" ? "Price" : "Offer price",
        );
        if (input.kind === "HOURLY" && priceMinor <= 0n) {
          throw new ValidationError("Hourly price must be greater than zero", "hourly_price_not_positive");
        }
        const minimumChargeMinor = input.minimumChargeMajor
          ? parseFriendlyMajor(input.minimumChargeMajor, currency, "Minimum charge")
          : 0n;

        const insertedPlan = await tx
          .insert(gamingPricingPlans)
          .values(
            input.kind === "HOURLY"
              ? {
                  id: planId,
                  organizationId: actor.organizationId,
                  code,
                  name,
                  pricingModel: "TIME_BASED",
                  currency,
                  rateMinor: priceMinor,
                  billingUnitSeconds: 3600,
                  roundingMode: "NEAREST",
                  timeBillingMode: TIME_BILLING_PRORATED_HOUR,
                  minimumBillableSeconds: 0,
                  minimumChargeMinor,
                  packageDurationSeconds: null,
                  packagePriceMinor: null,
                  status: "ACTIVE",
                }
              : {
                  id: planId,
                  organizationId: actor.organizationId,
                  code,
                  name,
                  pricingModel: "PACKAGE",
                  currency,
                  rateMinor: null,
                  billingUnitSeconds: null,
                  roundingMode: "CEIL",
                  timeBillingMode: TIME_BILLING_UNIT,
                  minimumBillableSeconds: 0,
                  minimumChargeMinor: 0n,
                  packageDurationSeconds: input.durationSeconds ?? null,
                  packagePriceMinor: priceMinor,
                  status: "ACTIVE",
                },
          )
          .returning();
        const plan = insertedPlan[0]!;
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          action: "gaming.pricing_plan.created",
          entityType: "gaming_pricing_plan",
          entityId: planId,
          after: snapshotPlan(plan),
        });

        const assignments: PricingAssignmentRecord[] = [];
        const priority = input.kind === "OFFER" ? OFFER_ASSIGNMENT_PRIORITY : 0;
        for (const target of targets) {
          const assignmentId = createId();
          const insertedAssignment = await tx
            .insert(gamingPricingAssignments)
            .values({
              id: assignmentId,
              organizationId: actor.organizationId,
              branchId: target.branchId,
              pricingPlanId: plan.id,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              priority,
              validFrom: new Date(),
              validTo: null,
              status: "ACTIVE",
            })
            .returning();
          const assignment = insertedAssignment[0]!;
          assignments.push(assignment);
          await recordAudit(tx, {
            organizationId: actor.organizationId,
            branchId: assignment.branchId,
            actorUserId: actor.userId,
            action: "gaming.pricing_assignment.created",
            entityType: "gaming_pricing_assignment",
            entityId: assignmentId,
            after: snapshotAssignment(assignment),
          });
        }

        return { plan, assignments };
      }),
  });
}
