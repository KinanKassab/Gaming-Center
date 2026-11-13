import { and, eq, inArray, sql } from "drizzle-orm";
import { AdminInvariantError } from "@/core/errors";
import {
  coreMembershipRoles,
  coreOrganizationMemberships,
  coreRolePermissions,
  coreRoles,
  coreUsers,
} from "@/db/schema";
import type { AppDatabase } from "@/db/tenant";
import { ADMIN_CRITICAL_PERMISSIONS } from "@/modules/identity/types";

/**
 * Owner-safety invariant: after any mutation that can reduce administrative
 * capability (suspending a membership, removing a role assignment, archiving a
 * role, editing role permissions), the organization must still contain at least
 * one ACTIVE membership — belonging to an ACTIVE user — whose effective
 * permissions include every ADMIN_CRITICAL_PERMISSION.
 *
 * Call inside the mutating transaction, after the write: throwing rolls the
 * whole mutation back. Permission-based on purpose — role names are not the
 * security engine.
 */
export async function assertOrganizationRetainsAdmin(
  tx: AppDatabase,
  organizationId: string,
): Promise<void> {
  // Serialize admin-reducing mutations per organization. Without this lock,
  // two concurrent transactions could each suspend a different administrator,
  // both pass the check against the pre-commit snapshot, and commit an
  // organization with zero admins (write skew).
  await tx.execute(
    sql`select id from core_organizations where id = ${organizationId} for update`,
  );

  const rows = await tx
    .select({
      membershipId: coreOrganizationMemberships.id,
      permissionCode: coreRolePermissions.permissionCode,
    })
    .from(coreOrganizationMemberships)
    .innerJoin(
      coreUsers,
      and(eq(coreUsers.id, coreOrganizationMemberships.userId), eq(coreUsers.status, "ACTIVE")),
    )
    .innerJoin(
      coreMembershipRoles,
      eq(coreMembershipRoles.membershipId, coreOrganizationMemberships.id),
    )
    .innerJoin(
      coreRoles,
      and(eq(coreRoles.id, coreMembershipRoles.roleId), eq(coreRoles.status, "ACTIVE")),
    )
    .innerJoin(coreRolePermissions, eq(coreRolePermissions.roleId, coreRoles.id))
    .where(
      and(
        eq(coreOrganizationMemberships.organizationId, organizationId),
        eq(coreOrganizationMemberships.status, "ACTIVE"),
        inArray(coreRolePermissions.permissionCode, [...ADMIN_CRITICAL_PERMISSIONS]),
      ),
    );

  const codesByMembership = new Map<string, Set<string>>();
  for (const row of rows) {
    const codes = codesByMembership.get(row.membershipId) ?? new Set<string>();
    codes.add(row.permissionCode);
    codesByMembership.set(row.membershipId, codes);
  }

  const hasFullAdmin = [...codesByMembership.values()].some((codes) =>
    ADMIN_CRITICAL_PERMISSIONS.every((code) => codes.has(code)),
  );

  if (!hasFullAdmin) {
    throw new AdminInvariantError(
      "Operation rejected: the organization would be left without an active administrator",
    );
  }
}
