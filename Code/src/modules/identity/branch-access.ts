import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@/core/errors";
import { assertPermission } from "@/core/tenancy";
import { coreBranchAccess, coreBranches, coreOrganizationMemberships } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { assertNotSelfMembership } from "@/modules/identity/self-guard";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

export const grantBranchAccessInputSchema = z.object({
  accessMode: z.enum(["VIEW", "OPERATE", "MANAGE"]),
});

export type GrantBranchAccessInput = z.infer<typeof grantBranchAccessInputSchema>;

/**
 * Grants or updates a membership's access to a branch. Branch access is
 * user-access administration, so it is governed by core.memberships.manage
 * (roles grant capabilities; branch access grants places — SEC-015/016).
 */
export async function grantBranchAccess(
  db: AppDatabase,
  actor: OrganizationActor,
  membershipId: string,
  branchId: string,
  input: GrantBranchAccessInput,
) {
  assertPermission(actor, PERMISSIONS.membershipsManage);
  assertNotSelfMembership(actor, membershipId);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const membership = await tx
      .select({ id: coreOrganizationMemberships.id })
      .from(coreOrganizationMemberships)
      .where(
        and(
          eq(coreOrganizationMemberships.id, membershipId),
          eq(coreOrganizationMemberships.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!membership[0]) throw new NotFoundError("Membership not found");

    const branchRows = await tx
      .select({ id: coreBranches.id, status: coreBranches.status })
      .from(coreBranches)
      .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, actor.organizationId)))
      .limit(1);
    const branch = branchRows[0];
    if (!branch) throw new NotFoundError("Branch not found in this organization");
    if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");

    const existingRows = await tx
      .select({ accessMode: coreBranchAccess.accessMode })
      .from(coreBranchAccess)
      .where(
        and(
          eq(coreBranchAccess.membershipId, membershipId),
          eq(coreBranchAccess.branchId, branchId),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (existing && existing.accessMode === input.accessMode) {
      return { membershipId, branchId, accessMode: input.accessMode };
    }

    if (existing) {
      await tx
        .update(coreBranchAccess)
        .set({ accessMode: input.accessMode })
        .where(
          and(
            eq(coreBranchAccess.membershipId, membershipId),
            eq(coreBranchAccess.branchId, branchId),
          ),
        );
    } else {
      await tx.insert(coreBranchAccess).values({
        organizationId: actor.organizationId,
        membershipId,
        branchId,
        accessMode: input.accessMode,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId,
      actorUserId: actor.userId,
      action: existing ? "core.branch_access.updated" : "core.branch_access.granted",
      entityType: "branch_access",
      entityId: membershipId,
      before: existing ? { accessMode: existing.accessMode } : null,
      after: { membershipId, branchId, accessMode: input.accessMode },
    });

    return { membershipId, branchId, accessMode: input.accessMode };
  });
}

export async function revokeBranchAccess(
  db: AppDatabase,
  actor: OrganizationActor,
  membershipId: string,
  branchId: string,
) {
  assertPermission(actor, PERMISSIONS.membershipsManage);
  assertNotSelfMembership(actor, membershipId);
  await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const deleted = await tx
      .delete(coreBranchAccess)
      .where(
        and(
          eq(coreBranchAccess.organizationId, actor.organizationId),
          eq(coreBranchAccess.membershipId, membershipId),
          eq(coreBranchAccess.branchId, branchId),
        ),
      )
      .returning();
    if (deleted.length === 0) throw new NotFoundError("Branch access grant not found");

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId,
      actorUserId: actor.userId,
      action: "core.branch_access.revoked",
      entityType: "branch_access",
      entityId: membershipId,
      before: { membershipId, branchId, accessMode: deleted[0]!.accessMode },
    });
  });
}
