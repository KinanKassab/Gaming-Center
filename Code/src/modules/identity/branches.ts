import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  isUniqueViolation,
  uniqueViolationMentions,
} from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import { coreBranchAccess, coreBranches, coreOrganizations } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

const optionalCodeSchema = z.string().max(32).optional();

/** Stable API reason for BUG-009 mapping. Never surface the unique index name. */
export const BRANCH_NAME_IN_USE_REASON = "branch_name_in_use";
const BRANCH_NAME_IN_USE_MESSAGE = "A branch with this name already exists in this organization";
const BRANCH_CODE_IN_USE_MESSAGE = "Branch code is already in use in this organization";

function branchNameConflict(): never {
  throw new ConflictError(BRANCH_NAME_IN_USE_MESSAGE, BRANCH_NAME_IN_USE_REASON);
}

function mapBranchInsertUnique(error: unknown): never {
  if (isUniqueViolation(error)) {
    if (uniqueViolationMentions(error, "core_branches_org_code_key")) {
      throw error;
    }
    branchNameConflict();
  }
  throw error;
}

function mapBranchUpdateUnique(error: unknown): never {
  if (isUniqueViolation(error)) {
    branchNameConflict();
  }
  throw error;
}

/**
 * Serialize same-org branch name changes and reject a visible-name collision
 * using PostgreSQL `lower(btrim(name))` — the same expression as migration 0014.
 * The unique index remains authoritative for raw SQL and races that bypass this path.
 */
async function assertVisibleBranchNameAvailable(
  tx: AppDatabase,
  organizationId: string,
  name: string,
  exceptBranchId?: string,
) {
  await tx.execute(sql`select id from core_organizations where id = ${organizationId} for update`);
  const taken = await tx
    .select({ id: coreBranches.id })
    .from(coreBranches)
    .where(
      exceptBranchId
        ? and(
            eq(coreBranches.organizationId, organizationId),
            ne(coreBranches.id, exceptBranchId),
            sql`lower(btrim(${coreBranches.name})) = lower(btrim(${name}))`,
          )
        : and(
            eq(coreBranches.organizationId, organizationId),
            sql`lower(btrim(${coreBranches.name})) = lower(btrim(${name}))`,
          ),
    )
    .limit(1);
  if (taken[0]) branchNameConflict();
}

export const createBranchInputSchema = z.object({
  code: optionalCodeSchema,
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64).optional(),
  addressText: z.string().trim().min(1).max(500).optional(),
  phone: z.string().trim().min(3).max(32).optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;

export const updateBranchInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(64).nullable().optional(),
    addressText: z.string().trim().min(1).max(500).nullable().optional(),
    phone: z.string().trim().min(3).max(32).nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateBranchInput = z.infer<typeof updateBranchInputSchema>;

export async function listBranches(db: AppDatabase, actor: OrganizationActor) {
  assertPermission(actor, PERMISSIONS.branchesRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    tx
      .select()
      .from(coreBranches)
      .where(eq(coreBranches.organizationId, actor.organizationId))
      .orderBy(coreBranches.code),
  );
}

/**
 * Creates a branch and grants the creating membership MANAGE access to it,
 * so an organization can never create a branch nobody can reach (ADR 0007).
 *
 * Visible names are unique per organization (trim + Latin case), including
 * archived rows. Codes remain unique separately (`core_branches_org_code_key`).
 */
export async function createBranch(db: AppDatabase, actor: OrganizationActor, input: CreateBranchInput) {
  assertPermission(actor, PERMISSIONS.branchesManage);
  const branchId = createId();
  const explicitCode = optionalInternalCode(input.code);
  const name = input.name;
  return insertWithAllocatedCode({
    explicit: explicitCode,
    prefix: "B-",
    label: "Branch code",
    conflictMessage: BRANCH_CODE_IN_USE_MESSAGE,
    isUniqueViolation: (error) =>
      isUniqueViolation(error) && uniqueViolationMentions(error, "core_branches_org_code_key"),
    insert: async (code) => {
      try {
        return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
          await assertVisibleBranchNameAvailable(tx, actor.organizationId, name);
          const orgRows = await tx
            .select({ timezone: coreOrganizations.timezone })
            .from(coreOrganizations)
            .where(eq(coreOrganizations.id, actor.organizationId))
            .limit(1);
          const inserted = await tx
            .insert(coreBranches)
            .values({
              id: branchId,
              organizationId: actor.organizationId,
              code,
              name,
              status: "ACTIVE",
              timezone: input.timezone ?? orgRows[0]?.timezone ?? null,
              addressText: input.addressText ?? null,
              phone: input.phone ?? null,
            })
            .returning();

          await tx.insert(coreBranchAccess).values({
            organizationId: actor.organizationId,
            membershipId: actor.membershipId,
            branchId,
            accessMode: "MANAGE",
          });

          await recordAudit(tx, {
            organizationId: actor.organizationId,
            branchId,
            actorUserId: actor.userId,
            action: "core.branch.created",
            entityType: "branch",
            entityId: branchId,
            after: { code, name },
          });

          await recordAudit(tx, {
            organizationId: actor.organizationId,
            branchId,
            actorUserId: actor.userId,
            action: "core.branch_access.granted",
            entityType: "branch_access",
            entityId: actor.membershipId,
            after: { membershipId: actor.membershipId, branchId, accessMode: "MANAGE" },
            metadata: { grantedBy: "branch_creation" },
          });

          return inserted[0]!;
        });
      } catch (error) {
        mapBranchInsertUnique(error);
      }
    },
  });
}

export async function updateBranch(
  db: AppDatabase,
  actor: OrganizationActor,
  branchId: string,
  input: UpdateBranchInput,
) {
  assertPermission(actor, PERMISSIONS.branchesManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(coreBranches)
      .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, actor.organizationId)))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundError("Branch not found");
    if (before.status === "ARCHIVED") throw new ConflictError("Archived branch cannot be updated");
    if (input.name !== undefined) {
      await assertVisibleBranchNameAvailable(tx, actor.organizationId, input.name, branchId);
    }

    const patch = {
      name: input.name ?? before.name,
      timezone: input.timezone === undefined ? before.timezone : input.timezone,
      addressText: input.addressText === undefined ? before.addressText : input.addressText,
      phone: input.phone === undefined ? before.phone : input.phone,
      status: input.status ?? before.status,
    };

    let updated;
    try {
      updated = await tx
        .update(coreBranches)
        .set(patch)
        .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, actor.organizationId)))
        .returning();
    } catch (error) {
      mapBranchUpdateUnique(error);
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId,
      actorUserId: actor.userId,
      action: "core.branch.updated",
      entityType: "branch",
      entityId: branchId,
      before: {
        name: before.name,
        timezone: before.timezone,
        addressText: before.addressText,
        phone: before.phone,
        status: before.status,
      },
      after: patch,
    });

    return updated[0]!;
  });
}

export async function archiveBranch(db: AppDatabase, actor: OrganizationActor, branchId: string) {
  assertPermission(actor, PERMISSIONS.branchesManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(coreBranches)
      .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, actor.organizationId)))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundError("Branch not found");
    if (before.status === "ARCHIVED") throw new ConflictError("Branch is already archived");

    const updated = await tx
      .update(coreBranches)
      .set({ status: "ARCHIVED", archivedAt: new Date() })
      .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, actor.organizationId)))
      .returning();

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId,
      actorUserId: actor.userId,
      action: "core.branch.archived",
      entityType: "branch",
      entityId: branchId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });

    return updated[0]!;
  });
}
