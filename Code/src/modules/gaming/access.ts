import { and, eq, inArray } from "drizzle-orm";
import type { BranchAccessMode } from "@/core/tenancy";
import { assertBranchAccess, assertPermission } from "@/core/tenancy";
import { ConflictError, NotFoundError } from "@/core/errors";
import { coreBranches } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

const RANK: Record<BranchAccessMode, number> = {
  VIEW: 1,
  OPERATE: 2,
  MANAGE: 3,
};

export function grantedBranchIds(actor: OrganizationActor, minimum: BranchAccessMode): string[] {
  return actor.branchAccess
    .filter((row) => RANK[row.accessMode] >= RANK[minimum])
    .map((row) => row.branchId);
}

export function requireBranchAccess(
  actor: OrganizationActor,
  branchId: string,
  minimum: BranchAccessMode,
): void {
  assertBranchAccess(actor, branchId, minimum);
}

export async function requireActiveBranch(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: coreBranches.id, status: coreBranches.status })
    .from(coreBranches)
    .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, organizationId)))
    .limit(1);
  const branch = rows[0];
  if (!branch) throw new NotFoundError("Branch not found in this organization");
  if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");
}

export async function listGrantedBranches(
  tx: AppDatabase,
  actor: OrganizationActor,
  minimum: BranchAccessMode,
) {
  const ids = grantedBranchIds(actor, minimum);
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(coreBranches)
    .where(and(eq(coreBranches.organizationId, actor.organizationId), inArray(coreBranches.id, ids)))
    .orderBy(coreBranches.code);
}

async function listBranchesForPermission(
  db: AppDatabase,
  actor: OrganizationActor,
  minimum: BranchAccessMode,
  permission: string,
) {
  assertPermission(actor, permission);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    listGrantedBranches(tx, actor, minimum),
  );
}

export async function listAccessibleBranches(
  db: AppDatabase,
  actor: OrganizationActor,
  minimum: BranchAccessMode = "VIEW",
) {
  return listBranchesForPermission(db, actor, minimum, PERMISSIONS.gamingMasterRead);
}

/** Branch picker for Floor / session history. Does not require gaming.master.read. */
export async function listSessionBranches(
  db: AppDatabase,
  actor: OrganizationActor,
  minimum: BranchAccessMode = "VIEW",
) {
  return listBranchesForPermission(db, actor, minimum, PERMISSIONS.gamingSessionsRead);
}
