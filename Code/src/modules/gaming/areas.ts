import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import { gamingAreas, gamingDevices } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { grantedBranchIds, requireActiveBranch, requireBranchAccess } from "./access";
import { likeSafe, normalizeRequiredName, uuidPattern } from "./normalize";

export const AREA_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type AreaStatus = (typeof AREA_STATUSES)[number];

export const createAreaInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id"),
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(200),
  sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
});

export type CreateAreaInput = z.infer<typeof createAreaInputSchema>;

export const updateAreaInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateAreaInput = z.infer<typeof updateAreaInputSchema>;

export const listAreasInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id").optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListAreasInput = z.infer<typeof listAreasInputSchema>;

export type AreaRecord = typeof gamingAreas.$inferSelect;

function snapshot(row: AreaRecord) {
  return {
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
    status: row.status,
  };
}

async function loadOwnArea(tx: AppDatabase, organizationId: string, areaId: string): Promise<AreaRecord> {
  const rows = await tx
    .select()
    .from(gamingAreas)
    .where(and(eq(gamingAreas.id, areaId), eq(gamingAreas.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Area not found");
  return row;
}

export async function listAreas(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListAreasInput = {},
): Promise<AreaRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  const limit = input.limit ?? 100;
  if (input.branchId) {
    requireBranchAccess(actor, input.branchId, "VIEW");
  }
  const visible = input.branchId ? [input.branchId] : grantedBranchIds(actor, "VIEW");
  if (visible.length === 0) return [];

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [
      eq(gamingAreas.organizationId, actor.organizationId),
      inArray(gamingAreas.branchId, visible),
    ];
    if (input.status) {
      filters.push(eq(gamingAreas.status, input.status));
    } else {
      filters.push(eq(gamingAreas.status, "ACTIVE"));
    }
    const q = input.q?.trim() ?? "";
    const safe = likeSafe(q);
    if (safe) {
      const pattern = `%${safe}%`;
      filters.push(or(ilike(gamingAreas.code, pattern), ilike(gamingAreas.name, pattern))!);
    }
    return tx
      .select()
      .from(gamingAreas)
      .where(and(...filters))
      .orderBy(asc(gamingAreas.sortOrder), asc(gamingAreas.code))
      .limit(limit);
  });
}

export async function getArea(db: AppDatabase, actor: OrganizationActor, areaId: string): Promise<AreaRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const area = await loadOwnArea(tx, actor.organizationId, areaId);
    requireBranchAccess(actor, area.branchId, "VIEW");
    return area;
  });
}

export async function createArea(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateAreaInput,
): Promise<AreaRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  requireBranchAccess(actor, input.branchId, "MANAGE");
  const name = normalizeRequiredName(input.name);
  const sortOrder = input.sortOrder ?? 0;
  const areaId = createId();
  const explicitCode = optionalInternalCode(input.code);

  return insertWithAllocatedCode({
    explicit: explicitCode,
    prefix: "A-",
    label: "Area code",
    conflictMessage: "Area code is already in use in this branch",
    isUniqueViolation,
    insert: async (code) =>
      withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
        await requireActiveBranch(tx, actor.organizationId, input.branchId);
        const inserted = await tx
          .insert(gamingAreas)
          .values({
            id: areaId,
            organizationId: actor.organizationId,
            branchId: input.branchId,
            code,
            name,
            sortOrder,
            status: "ACTIVE",
          })
          .returning();
        const area = inserted[0]!;
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          actorUserId: actor.userId,
          action: "gaming.area.created",
          entityType: "gaming_area",
          entityId: areaId,
          after: snapshot(area),
        });
        return area;
      }),
  });
}

export async function updateArea(
  db: AppDatabase,
  actor: OrganizationActor,
  areaId: string,
  input: UpdateAreaInput,
): Promise<AreaRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const nextName = input.name !== undefined ? normalizeRequiredName(input.name) : undefined;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnArea(tx, actor.organizationId, areaId);
    requireBranchAccess(actor, before.branchId, "MANAGE");
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Archived area cannot be updated");
    }
    const patch = {
      name: nextName ?? before.name,
      sortOrder: input.sortOrder ?? before.sortOrder,
    };
    const updated = await tx
      .update(gamingAreas)
      .set(patch)
      .where(and(eq(gamingAreas.id, areaId), eq(gamingAreas.organizationId, actor.organizationId)))
      .returning();
    const area = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: area.branchId,
      actorUserId: actor.userId,
      action: "gaming.area.updated",
      entityType: "gaming_area",
      entityId: areaId,
      before: snapshot(before),
      after: snapshot(area),
    });
    return area;
  });
}

export async function archiveArea(
  db: AppDatabase,
  actor: OrganizationActor,
  areaId: string,
): Promise<AreaRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnArea(tx, actor.organizationId, areaId);
    requireBranchAccess(actor, before.branchId, "MANAGE");
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Area is already archived");
    }

    const occupied = await tx
      .select({ id: gamingDevices.id })
      .from(gamingDevices)
      .where(
        and(
          eq(gamingDevices.organizationId, actor.organizationId),
          eq(gamingDevices.areaId, areaId),
          isNull(gamingDevices.archivedAt),
        ),
      )
      .limit(1);
    if (occupied[0]) {
      throw new ConflictError("Archive or reassign devices in this area first");
    }

    const updated = await tx
      .update(gamingAreas)
      .set({ status: "ARCHIVED" })
      .where(and(eq(gamingAreas.id, areaId), eq(gamingAreas.organizationId, actor.organizationId)))
      .returning();
    const area = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: area.branchId,
      actorUserId: actor.userId,
      action: "gaming.area.archived",
      entityType: "gaming_area",
      entityId: areaId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });
    return area;
  });
}
