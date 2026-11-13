import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import {
  gamingAreas,
  gamingDeviceTypes,
  gamingDevices,
  gamingPricingAssignments,
  gamingPricingPlans,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { grantedBranchIds, requireActiveBranch, requireBranchAccess } from "./access";
import { uuidPattern } from "./normalize";

export const ASSIGNMENT_SCOPE_TYPES = ["ORGANIZATION", "BRANCH", "AREA", "DEVICE_TYPE", "DEVICE"] as const;
export type AssignmentScopeType = (typeof ASSIGNMENT_SCOPE_TYPES)[number];

export const createPricingAssignmentInputSchema = z.object({
  pricingPlanId: z.string().regex(uuidPattern, "Invalid pricing plan id"),
  scopeType: z.enum(["ORGANIZATION", "BRANCH", "AREA", "DEVICE_TYPE", "DEVICE"]),
  scopeId: z.string().regex(uuidPattern, "Invalid scope id").optional(),
  branchId: z.string().regex(uuidPattern, "Invalid branch id").optional().nullable(),
  priority: z.coerce.number().int().min(-100000).max(100000).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional().nullable(),
});

export type CreatePricingAssignmentInput = z.infer<typeof createPricingAssignmentInputSchema>;

export const updatePricingAssignmentInputSchema = z
  .object({
    priority: z.coerce.number().int().min(-100000).max(100000).optional(),
    validTo: z.coerce.date().nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdatePricingAssignmentInput = z.infer<typeof updatePricingAssignmentInputSchema>;

export const listPricingAssignmentsInputSchema = z.object({
  pricingPlanId: z.string().regex(uuidPattern).optional(),
  scopeType: z.enum(["ORGANIZATION", "BRANCH", "AREA", "DEVICE_TYPE", "DEVICE"]).optional(),
  branchId: z.string().regex(uuidPattern).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListPricingAssignmentsInput = z.infer<typeof listPricingAssignmentsInputSchema>;

export type PricingAssignmentRecord = typeof gamingPricingAssignments.$inferSelect;

function snapshot(row: PricingAssignmentRecord) {
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

async function loadOwnAssignment(
  tx: AppDatabase,
  organizationId: string,
  assignmentId: string,
): Promise<PricingAssignmentRecord> {
  const rows = await tx
    .select()
    .from(gamingPricingAssignments)
    .where(
      and(
        eq(gamingPricingAssignments.id, assignmentId),
        eq(gamingPricingAssignments.organizationId, organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Pricing assignment not found");
  return row;
}

function assertCanReadAssignment(actor: OrganizationActor, row: PricingAssignmentRecord): void {
  if (!row.branchId) return;
  requireBranchAccess(actor, row.branchId, "VIEW");
}

function resolveScope(actor: OrganizationActor, input: CreatePricingAssignmentInput): {
  scopeType: AssignmentScopeType;
  scopeId: string;
  branchId: string | null;
} {
  const scopeType = input.scopeType;
  if (scopeType === "ORGANIZATION") {
    return { scopeType, scopeId: actor.organizationId, branchId: null };
  }
  if (scopeType === "BRANCH") {
    const branchId = input.branchId ?? input.scopeId;
    if (!branchId) throw new ValidationError("BRANCH assignment requires branchId");
    return { scopeType, scopeId: branchId, branchId };
  }
  if (scopeType === "DEVICE_TYPE") {
    const scopeId = input.scopeId;
    if (!scopeId) throw new ValidationError("DEVICE_TYPE assignment requires scopeId");
    return { scopeType, scopeId, branchId: null };
  }
  const branchId = input.branchId;
  const scopeId = input.scopeId;
  if (!branchId || !scopeId) {
    throw new ValidationError(`${scopeType} assignment requires branchId and scopeId`);
  }
  return { scopeType, scopeId, branchId };
}

async function assertScopeExists(
  tx: AppDatabase,
  organizationId: string,
  scope: { scopeType: AssignmentScopeType; scopeId: string; branchId: string | null },
): Promise<void> {
  if (scope.scopeType === "ORGANIZATION") {
    if (scope.scopeId !== organizationId) {
      throw new ValidationError("ORGANIZATION assignment scope must be the current organization");
    }
    return;
  }
  if (scope.scopeType === "BRANCH") {
    await requireActiveBranch(tx, organizationId, scope.scopeId);
    return;
  }
  if (scope.scopeType === "DEVICE_TYPE") {
    const rows = await tx
      .select({ id: gamingDeviceTypes.id, status: gamingDeviceTypes.status })
      .from(gamingDeviceTypes)
      .where(and(eq(gamingDeviceTypes.id, scope.scopeId), eq(gamingDeviceTypes.organizationId, organizationId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("Device type not found");
    return;
  }
  if (scope.scopeType === "AREA") {
    const rows = await tx
      .select()
      .from(gamingAreas)
      .where(and(eq(gamingAreas.id, scope.scopeId), eq(gamingAreas.organizationId, organizationId)))
      .limit(1);
    const area = rows[0];
    if (!area) throw new NotFoundError("Area not found");
    if (area.branchId !== scope.branchId) {
      throw new ValidationError("Area does not belong to this branch");
    }
    return;
  }
  const rows = await tx
    .select()
    .from(gamingDevices)
    .where(and(eq(gamingDevices.id, scope.scopeId), eq(gamingDevices.organizationId, organizationId)))
    .limit(1);
  const device = rows[0];
  if (!device) throw new NotFoundError("Device not found");
  if (device.branchId !== scope.branchId) {
    throw new ValidationError("Device does not belong to this branch");
  }
}

export async function listPricingAssignments(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListPricingAssignmentsInput = {},
): Promise<PricingAssignmentRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  const limit = input.limit ?? 100;
  if (input.branchId) {
    requireBranchAccess(actor, input.branchId, "VIEW");
  }
  const visibleBranches = grantedBranchIds(actor, "VIEW");

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [eq(gamingPricingAssignments.organizationId, actor.organizationId)];
    if (input.pricingPlanId) {
      filters.push(eq(gamingPricingAssignments.pricingPlanId, input.pricingPlanId));
    }
    if (input.scopeType) {
      filters.push(eq(gamingPricingAssignments.scopeType, input.scopeType));
    }
    if (input.status) {
      filters.push(eq(gamingPricingAssignments.status, input.status));
    } else {
      filters.push(eq(gamingPricingAssignments.status, "ACTIVE"));
    }
    if (input.branchId) {
      filters.push(eq(gamingPricingAssignments.branchId, input.branchId));
    } else if (visibleBranches.length === 0) {
      filters.push(isNull(gamingPricingAssignments.branchId));
    } else {
      filters.push(
        or(
          isNull(gamingPricingAssignments.branchId),
          inArray(gamingPricingAssignments.branchId, visibleBranches),
        )!,
      );
    }

    return tx
      .select()
      .from(gamingPricingAssignments)
      .where(and(...filters))
      .orderBy(desc(gamingPricingAssignments.validFrom))
      .limit(limit);
  });
}

export async function getPricingAssignment(
  db: AppDatabase,
  actor: OrganizationActor,
  assignmentId: string,
): Promise<PricingAssignmentRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const row = await loadOwnAssignment(tx, actor.organizationId, assignmentId);
    assertCanReadAssignment(actor, row);
    return row;
  });
}

export async function createPricingAssignment(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreatePricingAssignmentInput,
): Promise<PricingAssignmentRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const scope = resolveScope(actor, input);
  if (scope.branchId) {
    requireBranchAccess(actor, scope.branchId, "MANAGE");
  }
  if (input.validTo && input.validFrom && input.validTo <= input.validFrom) {
    throw new ValidationError("validTo must be after validFrom");
  }
  const assignmentId = createId();

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const plans = await tx
      .select()
      .from(gamingPricingPlans)
      .where(
        and(
          eq(gamingPricingPlans.id, input.pricingPlanId),
          eq(gamingPricingPlans.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    const plan = plans[0];
    if (!plan) throw new NotFoundError("Pricing plan not found");
    if (plan.status === "ARCHIVED") throw new ConflictError("Pricing plan is archived");
    await assertScopeExists(tx, actor.organizationId, scope);

    const inserted = await tx
      .insert(gamingPricingAssignments)
      .values({
        id: assignmentId,
        organizationId: actor.organizationId,
        branchId: scope.branchId,
        pricingPlanId: input.pricingPlanId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        priority: input.priority ?? 0,
        validFrom: input.validFrom ?? new Date(),
        validTo: input.validTo ?? null,
        status: "ACTIVE",
      })
      .returning();
    const assignment = inserted[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: assignment.branchId,
      actorUserId: actor.userId,
      action: "gaming.pricing_assignment.created",
      entityType: "gaming_pricing_assignment",
      entityId: assignmentId,
      after: snapshot(assignment),
    });
    return assignment;
  });
}

export async function updatePricingAssignment(
  db: AppDatabase,
  actor: OrganizationActor,
  assignmentId: string,
  input: UpdatePricingAssignmentInput,
): Promise<PricingAssignmentRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnAssignment(tx, actor.organizationId, assignmentId);
    if (before.branchId) {
      requireBranchAccess(actor, before.branchId, "MANAGE");
    }
    const validTo = input.validTo === undefined ? before.validTo : input.validTo;
    if (validTo && validTo <= before.validFrom) {
      throw new ValidationError("validTo must be after validFrom");
    }
    const patch = {
      priority: input.priority ?? before.priority,
      validTo,
      status: input.status ?? before.status,
    };
    const updated = await tx
      .update(gamingPricingAssignments)
      .set(patch)
      .where(
        and(
          eq(gamingPricingAssignments.id, assignmentId),
          eq(gamingPricingAssignments.organizationId, actor.organizationId),
        ),
      )
      .returning();
    const assignment = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: assignment.branchId,
      actorUserId: actor.userId,
      action: "gaming.pricing_assignment.updated",
      entityType: "gaming_pricing_assignment",
      entityId: assignmentId,
      before: snapshot(before),
      after: snapshot(assignment),
    });
    return assignment;
  });
}
