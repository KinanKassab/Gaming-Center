import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { parseFriendlyMajor, roundingFromPartialPeriod, type PartialPeriodPolicy } from "./pricing-adapter";
import { TIME_BILLING_PRORATED_HOUR, TIME_BILLING_UNIT, type TimeBillingMode } from "./billing-prorated";
import { assertPermission } from "@/core/tenancy";
import { coreOrganizations, gamingPricingPlans } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { likeSafe, minorToJson, normalizeRequiredName, parseNonNegativeMinor } from "./normalize";

export const PRICING_MODELS = ["TIME_BASED", "PACKAGE"] as const;
export const ROUNDING_MODES = ["CEIL", "NEAREST", "FLOOR"] as const;
export const PRICING_PLAN_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

const minorInput = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/), z.bigint()]);
const majorInput = z.string().trim().min(1).max(32);

export const createPricingPlanInputSchema = z.object({
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(200),
  pricingModel: z.enum(["TIME_BASED", "PACKAGE"]),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code")
    .optional(),
  rateMinor: minorInput.optional().nullable(),
  priceMajor: majorInput.optional(),
  billingUnitSeconds: z.coerce.number().int().positive().optional().nullable(),
  roundingMode: z.enum(["CEIL", "NEAREST", "FLOOR"]).optional(),
  partialPeriod: z.enum(["started", "nearest", "completed"]).optional(),
  minimumBillableSeconds: z.coerce.number().int().min(0).optional(),
  minimumChargeMinor: minorInput.optional(),
  minimumChargeMajor: majorInput.optional(),
  packageDurationSeconds: z.coerce.number().int().positive().optional().nullable(),
  packagePriceMinor: minorInput.optional().nullable(),
  packagePriceMajor: majorInput.optional(),
  timeBillingMode: z.enum(["UNIT", "PRORATED_HOUR"]).optional(),
});

export type CreatePricingPlanInput = z.infer<typeof createPricingPlanInputSchema>;

export const updatePricingPlanInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    pricingModel: z.enum(["TIME_BASED", "PACKAGE"]).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    rateMinor: minorInput.optional().nullable(),
    priceMajor: majorInput.optional(),
    billingUnitSeconds: z.coerce.number().int().positive().optional().nullable(),
    roundingMode: z.enum(["CEIL", "NEAREST", "FLOOR"]).optional(),
    partialPeriod: z.enum(["started", "nearest", "completed"]).optional(),
    minimumBillableSeconds: z.coerce.number().int().min(0).optional(),
    minimumChargeMinor: minorInput.optional(),
    minimumChargeMajor: majorInput.optional(),
    packageDurationSeconds: z.coerce.number().int().positive().optional().nullable(),
    packagePriceMinor: minorInput.optional().nullable(),
    packagePriceMajor: majorInput.optional(),
    timeBillingMode: z.enum(["UNIT", "PRORATED_HOUR"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdatePricingPlanInput = z.infer<typeof updatePricingPlanInputSchema>;

export const listPricingPlansInputSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListPricingPlansInput = z.infer<typeof listPricingPlansInputSchema>;

export type PricingPlanRecord = typeof gamingPricingPlans.$inferSelect;

export type PricingPlanJson = Omit<
  PricingPlanRecord,
  "rateMinor" | "minimumChargeMinor" | "packagePriceMinor"
> & {
  rateMinor: string | null;
  minimumChargeMinor: string;
  packagePriceMinor: string | null;
};

export function serializePricingPlan(row: PricingPlanRecord): PricingPlanJson {
  return {
    ...row,
    rateMinor: minorToJson(row.rateMinor),
    minimumChargeMinor: row.minimumChargeMinor.toString(),
    packagePriceMinor: minorToJson(row.packagePriceMinor),
  };
}

function snapshot(row: PricingPlanRecord) {
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

type PlanShape = {
  pricingModel: "TIME_BASED" | "PACKAGE";
  rateMinor: bigint | null;
  billingUnitSeconds: number | null;
  packageDurationSeconds: number | null;
  packagePriceMinor: bigint | null;
};

function assertPlanShape(shape: PlanShape): void {
  if (shape.pricingModel === "TIME_BASED") {
    if (shape.rateMinor == null || shape.billingUnitSeconds == null) {
      throw new ValidationError("Hourly (time-based) plans need a price and a billing period");
    }
    if (shape.packageDurationSeconds != null || shape.packagePriceMinor != null) {
      throw new ValidationError("TIME_BASED plans cannot include package fields");
    }
    return;
  }
  if (shape.packageDurationSeconds == null || shape.packagePriceMinor == null) {
    throw new ValidationError("Package plans need a price and a duration");
  }
  if (shape.rateMinor != null || shape.billingUnitSeconds != null) {
    throw new ValidationError("PACKAGE plans cannot include time-based rate fields");
  }
}

function resolveRoundingMode(input: {
  roundingMode?: "CEIL" | "NEAREST" | "FLOOR" | undefined;
  partialPeriod?: PartialPeriodPolicy | undefined;
}): "CEIL" | "NEAREST" | "FLOOR" {
  if (input.roundingMode && input.partialPeriod) {
    const fromPolicy = roundingFromPartialPeriod(input.partialPeriod);
    if (fromPolicy !== input.roundingMode) {
      throw new ValidationError("Partial-period setting does not match rounding mode");
    }
  }
  if (input.roundingMode) return input.roundingMode;
  if (input.partialPeriod) return roundingFromPartialPeriod(input.partialPeriod);
  return "CEIL";
}

function resolveTimeBillingMode(input: {
  pricingModel: "TIME_BASED" | "PACKAGE";
  timeBillingMode?: TimeBillingMode | undefined;
  roundingMode?: "CEIL" | "NEAREST" | "FLOOR" | undefined;
  partialPeriod?: PartialPeriodPolicy | undefined;
}): TimeBillingMode {
  if (input.pricingModel === "PACKAGE") {
    if (input.timeBillingMode === TIME_BILLING_PRORATED_HOUR) {
      throw new ValidationError("Package plans cannot use prorated hourly billing");
    }
    return TIME_BILLING_UNIT;
  }
  if (input.timeBillingMode) return input.timeBillingMode;
  if (input.roundingMode || input.partialPeriod) return TIME_BILLING_UNIT;
  return TIME_BILLING_PRORATED_HOUR;
}

function resolveTimeRate(input: {
  rateMinor?: string | number | bigint | null | undefined;
  priceMajor?: string | undefined;
  currency: string;
}): bigint | null {
  if (input.rateMinor != null && input.priceMajor) {
    throw new ValidationError("Provide either price or rateMinor, not both");
  }
  if (input.priceMajor) return parseFriendlyMajor(input.priceMajor, input.currency, "Price");
  if (input.rateMinor != null) return optionalMinor(input.rateMinor, "rateMinor") ?? null;
  return null;
}

function resolvePackagePrice(input: {
  packagePriceMinor?: string | number | bigint | null | undefined;
  packagePriceMajor?: string | undefined;
  currency: string;
}): bigint | null {
  if (input.packagePriceMinor != null && input.packagePriceMajor) {
    throw new ValidationError("Provide either package price or packagePriceMinor, not both");
  }
  if (input.packagePriceMajor) {
    return parseFriendlyMajor(input.packagePriceMajor, input.currency, "Package price");
  }
  if (input.packagePriceMinor != null) {
    return optionalMinor(input.packagePriceMinor, "packagePriceMinor") ?? null;
  }
  return null;
}

function resolveMinimumCharge(input: {
  minimumChargeMinor?: string | number | bigint | undefined;
  minimumChargeMajor?: string | undefined;
  currency: string;
}): bigint {
  if (input.minimumChargeMinor != null && input.minimumChargeMajor) {
    throw new ValidationError("Provide either minimum charge or minimumChargeMinor, not both");
  }
  if (input.minimumChargeMajor) {
    return parseFriendlyMajor(input.minimumChargeMajor, input.currency, "Minimum charge");
  }
  if (input.minimumChargeMinor != null) {
    return optionalMinor(input.minimumChargeMinor, "minimumChargeMinor") ?? 0n;
  }
  return 0n;
}
function optionalMinor(
  value: string | number | bigint | null | undefined,
  label: string,
): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseNonNegativeMinor(value, label);
}

async function loadOwnPlan(
  tx: AppDatabase,
  organizationId: string,
  planId: string,
): Promise<PricingPlanRecord> {
  const rows = await tx
    .select()
    .from(gamingPricingPlans)
    .where(and(eq(gamingPricingPlans.id, planId), eq(gamingPricingPlans.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Pricing plan not found");
  return row;
}

export async function listPricingPlans(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListPricingPlansInput = {},
): Promise<PricingPlanRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  const limit = input.limit ?? 100;
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [eq(gamingPricingPlans.organizationId, actor.organizationId)];
    if (input.status) {
      filters.push(eq(gamingPricingPlans.status, input.status));
    } else {
      filters.push(eq(gamingPricingPlans.status, "ACTIVE"));
    }
    const q = input.q?.trim() ?? "";
    const safe = likeSafe(q);
    if (safe) {
      const pattern = `%${safe}%`;
      filters.push(or(ilike(gamingPricingPlans.code, pattern), ilike(gamingPricingPlans.name, pattern))!);
    }
    return tx
      .select()
      .from(gamingPricingPlans)
      .where(and(...filters))
      .orderBy(asc(gamingPricingPlans.code))
      .limit(limit);
  });
}

export async function getPricingPlan(
  db: AppDatabase,
  actor: OrganizationActor,
  planId: string,
): Promise<PricingPlanRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOwnPlan(tx, actor.organizationId, planId),
  );
}

export async function createPricingPlan(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreatePricingPlanInput,
): Promise<PricingPlanRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const name = normalizeRequiredName(input.name);
  const planId = createId();
  const explicitCode = optionalInternalCode(input.code);

  return insertWithAllocatedCode({
    explicit: explicitCode,
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
        const currency = input.currency ?? orgRows[0]?.defaultCurrency;
        if (!currency) throw new ValidationError("Currency is required");

        const timeBillingMode = resolveTimeBillingMode({
          pricingModel: input.pricingModel,
          timeBillingMode: input.timeBillingMode,
          roundingMode: input.roundingMode,
          partialPeriod: input.partialPeriod,
        });
        const roundingMode =
          timeBillingMode === TIME_BILLING_PRORATED_HOUR ? "NEAREST" : resolveRoundingMode(input);
        const rateMinor =
          input.pricingModel === "TIME_BASED"
            ? resolveTimeRate({
                rateMinor: input.rateMinor,
                priceMajor: input.priceMajor,
                currency,
              })
            : input.rateMinor !== undefined
              ? (optionalMinor(input.rateMinor, "rateMinor") ?? null)
              : null;
        const packagePriceMinor =
          input.pricingModel === "PACKAGE"
            ? resolvePackagePrice({
                packagePriceMinor: input.packagePriceMinor,
                packagePriceMajor: input.packagePriceMajor,
                currency,
              })
            : input.packagePriceMinor !== undefined
              ? (optionalMinor(input.packagePriceMinor, "packagePriceMinor") ?? null)
              : null;
        const billingUnitSeconds =
          input.pricingModel === "TIME_BASED"
            ? (input.billingUnitSeconds ?? 3600)
            : (input.billingUnitSeconds ?? null);
        const shape: PlanShape = {
          pricingModel: input.pricingModel,
          rateMinor,
          billingUnitSeconds,
          packageDurationSeconds: input.packageDurationSeconds ?? null,
          packagePriceMinor,
        };
        assertPlanShape(shape);
        const minimumChargeMinor = resolveMinimumCharge({
          minimumChargeMinor: input.minimumChargeMinor,
          minimumChargeMajor: input.minimumChargeMajor,
          currency,
        });

        const inserted = await tx
          .insert(gamingPricingPlans)
          .values({
            id: planId,
            organizationId: actor.organizationId,
            code,
            name,
            pricingModel: shape.pricingModel,
            currency,
            rateMinor: shape.rateMinor,
            billingUnitSeconds: shape.billingUnitSeconds,
            roundingMode,
            timeBillingMode,
            minimumBillableSeconds: input.minimumBillableSeconds ?? 0,
            minimumChargeMinor,
            packageDurationSeconds: shape.packageDurationSeconds,
            packagePriceMinor: shape.packagePriceMinor,
            status: "ACTIVE",
          })
          .returning();
        const plan = inserted[0]!;
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          action: "gaming.pricing_plan.created",
          entityType: "gaming_pricing_plan",
          entityId: planId,
          after: snapshot(plan),
        });
        return plan;
      }),
  });
}

export async function updatePricingPlan(
  db: AppDatabase,
  actor: OrganizationActor,
  planId: string,
  input: UpdatePricingPlanInput,
): Promise<PricingPlanRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const nextName = input.name !== undefined ? normalizeRequiredName(input.name) : undefined;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnPlan(tx, actor.organizationId, planId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Archived pricing plan cannot be updated");
    }
    const pricingModel = input.pricingModel ?? (before.pricingModel as PlanShape["pricingModel"]);
    const currency = input.currency ?? before.currency;
    const timeBillingMode =
      input.timeBillingMode !== undefined
        ? resolveTimeBillingMode({
            pricingModel,
            timeBillingMode: input.timeBillingMode,
            roundingMode: input.roundingMode,
            partialPeriod: input.partialPeriod,
          })
        : (before.timeBillingMode as TimeBillingMode);
    const roundingMode =
      timeBillingMode === TIME_BILLING_PRORATED_HOUR
        ? "NEAREST"
        : input.roundingMode !== undefined || input.partialPeriod !== undefined
          ? resolveRoundingMode(input)
          : (before.roundingMode as "CEIL" | "NEAREST" | "FLOOR");
    const rateMinor =
      input.rateMinor !== undefined || input.priceMajor !== undefined
        ? resolveTimeRate({
            rateMinor: input.rateMinor,
            priceMajor: input.priceMajor,
            currency,
          })
        : before.rateMinor;
    const packagePriceMinor =
      input.packagePriceMinor !== undefined || input.packagePriceMajor !== undefined
        ? resolvePackagePrice({
            packagePriceMinor: input.packagePriceMinor,
            packagePriceMajor: input.packagePriceMajor,
            currency,
          })
        : before.packagePriceMinor;
    const shape: PlanShape = {
      pricingModel,
      rateMinor,
      billingUnitSeconds:
        input.billingUnitSeconds !== undefined ? input.billingUnitSeconds : before.billingUnitSeconds,
      packageDurationSeconds:
        input.packageDurationSeconds !== undefined
          ? input.packageDurationSeconds
          : before.packageDurationSeconds,
      packagePriceMinor,
    };
    assertPlanShape(shape);
    const patch = {
      name: nextName ?? before.name,
      pricingModel: shape.pricingModel,
      currency,
      rateMinor: shape.rateMinor,
      billingUnitSeconds: shape.billingUnitSeconds,
      roundingMode,
      timeBillingMode,
      minimumBillableSeconds: input.minimumBillableSeconds ?? before.minimumBillableSeconds,
      minimumChargeMinor:
        input.minimumChargeMinor !== undefined || input.minimumChargeMajor !== undefined
          ? resolveMinimumCharge({
              minimumChargeMinor: input.minimumChargeMinor,
              minimumChargeMajor: input.minimumChargeMajor,
              currency,
            })
          : before.minimumChargeMinor,
      packageDurationSeconds: shape.packageDurationSeconds,
      packagePriceMinor: shape.packagePriceMinor,
    };
    const updated = await tx
      .update(gamingPricingPlans)
      .set(patch)
      .where(and(eq(gamingPricingPlans.id, planId), eq(gamingPricingPlans.organizationId, actor.organizationId)))
      .returning();
    const plan = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gaming.pricing_plan.updated",
      entityType: "gaming_pricing_plan",
      entityId: planId,
      before: snapshot(before),
      after: snapshot(plan),
    });
    return plan;
  });
}

export async function archivePricingPlan(
  db: AppDatabase,
  actor: OrganizationActor,
  planId: string,
): Promise<PricingPlanRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnPlan(tx, actor.organizationId, planId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Pricing plan is already archived");
    }
    const updated = await tx
      .update(gamingPricingPlans)
      .set({ status: "ARCHIVED" })
      .where(and(eq(gamingPricingPlans.id, planId), eq(gamingPricingPlans.organizationId, actor.organizationId)))
      .returning();
    const plan = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gaming.pricing_plan.archived",
      entityType: "gaming_pricing_plan",
      entityId: planId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });
    return plan;
  });
}
