import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from "@/core/errors";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import {
  coreBranchAccess,
  coreBranches,
  coreMembershipRoles,
  coreOrganizationMemberships,
  coreRolePermissions,
  coreRoles,
  coreUsers,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { assertOrganizationRetainsAdmin } from "@/modules/identity/admin-guard";
import { assertNotSelfMembership } from "@/modules/identity/self-guard";
import { ensureCoreUser, findCoreUserByEmail, isPurgedStaffAccount, staffPurgeAfterFrom } from "@/modules/identity/core-user";
import {
  PERMISSIONS,
  type AuthAccountProvisioner,
  type OrganizationActor,
} from "@/modules/identity/types";
import { soleActiveBranchIdForDefaultOperateGrant } from "@/modules/identity/sole-branch-grant";

export const createUserWithMembershipInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  // Better Auth default policy is 8..128; keep the boundary aligned.
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(200),
});

export type CreateUserWithMembershipInput = z.infer<typeof createUserWithMembershipInputSchema>;

export const attachUserByEmailInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

export type AttachUserByEmailInput = z.infer<typeof attachUserByEmailInputSchema>;

/** Client-facing add-member failure. Same text for unknown / existing / already-member. */
export const ADD_MEMBER_REJECTED_MESSAGE = "Unable to add this member";

function rejectAddMember(reason: string, organizationId: string): never {
  console.info("[identity.add-member] rejected", { reason, organizationId });
  throw new ConflictError(ADD_MEMBER_REJECTED_MESSAGE);
}

export type MembershipSummary = {
  membershipId: string;
  status: string;
  joinedAt: Date | null;
  user: { id: string; displayName: string; email: string | null; status: string };
  roles: Array<{ roleId: string; code: string; name: string; status: string }>;
  branchAccess: Array<{ branchId: string; accessMode: string }>;
};

export async function listMemberships(
  db: AppDatabase,
  actor: OrganizationActor,
): Promise<MembershipSummary[]> {
  assertPermission(actor, PERMISSIONS.membershipsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const memberships = await tx
      .select({
        membershipId: coreOrganizationMemberships.id,
        status: coreOrganizationMemberships.status,
        joinedAt: coreOrganizationMemberships.joinedAt,
        userId: coreUsers.id,
        displayName: coreUsers.displayName,
        email: coreUsers.email,
        userStatus: coreUsers.status,
      })
      .from(coreOrganizationMemberships)
      .innerJoin(coreUsers, eq(coreUsers.id, coreOrganizationMemberships.userId))
      .where(eq(coreOrganizationMemberships.organizationId, actor.organizationId));

    const roleRows = await tx
      .select({
        membershipId: coreMembershipRoles.membershipId,
        roleId: coreRoles.id,
        code: coreRoles.code,
        name: coreRoles.name,
        status: coreRoles.status,
      })
      .from(coreMembershipRoles)
      .innerJoin(coreRoles, eq(coreRoles.id, coreMembershipRoles.roleId))
      .where(eq(coreMembershipRoles.organizationId, actor.organizationId));

    const accessRows = await tx
      .select({
        membershipId: coreBranchAccess.membershipId,
        branchId: coreBranchAccess.branchId,
        accessMode: coreBranchAccess.accessMode,
      })
      .from(coreBranchAccess)
      .where(eq(coreBranchAccess.organizationId, actor.organizationId));

    return memberships.map((row) => ({
      membershipId: row.membershipId,
      status: row.status,
      joinedAt: row.joinedAt,
      user: { id: row.userId, displayName: row.displayName, email: row.email, status: row.userStatus },
      roles: roleRows
        .filter((role) => role.membershipId === row.membershipId)
        .map(({ roleId, code, name, status }) => ({ roleId, code, name, status })),
      branchAccess: accessRows
        .filter((access) => access.membershipId === row.membershipId)
        .map(({ branchId, accessMode }) => ({ branchId, accessMode })),
    }));
  });
}

/**
 * Admin-created account (no email transport is decided yet, ADR 0003): the
 * administrator sets the initial credentials, so the membership starts ACTIVE.
 *
 * Consistency (M-04): Better Auth provisioning is a separate transaction from
 * the membership insert. If a Core User already exists for the email (retry
 * after a later domain failure, or a race), this path attaches that identity
 * instead of creating a second login. It never deletes a legitimate identity.
 */
export async function createUserWithMembership(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateUserWithMembershipInput,
  provisionAuthAccount: AuthAccountProvisioner,
): Promise<{ userId: string; membershipId: string }> {
  assertPermission(actor, PERMISSIONS.membershipsManage);

  let user = await findCoreUserByEmail(db, input.email);
  if (!user) {
    try {
      const { authSubject } = await provisionAuthAccount({
        email: input.email,
        password: input.password,
        name: input.displayName,
      });
      user = await ensureCoreUser(db, {
        authSubject,
        email: input.email,
        displayName: input.displayName,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        user = await findCoreUserByEmail(db, input.email);
      }
      if (!user) {
        if (error instanceof ConflictError) {
          rejectAddMember("identity_exists_unresolved", actor.organizationId);
        }
        throw error;
      }
      console.info("[identity.add-member] converged existing identity after provision conflict", {
        organizationId: actor.organizationId,
      });
    }
  } else {
      console.info("[identity.add-member] using existing identity for membership create", {
        organizationId: actor.organizationId,
      });
    }

  if (!user) {
    throw new Error("Core User was not resolved for membership create");
  }

  const membershipId = createId();
  try {
    await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      await tx.insert(coreOrganizationMemberships).values({
        id: membershipId,
        organizationId: actor.organizationId,
        userId: user.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      });

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "core.user.created",
        entityType: "user",
        entityId: user.id,
        after: { displayName: input.displayName, email: input.email },
        metadata: { createdVia: "admin_create" },
      });

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "core.membership.created",
        entityType: "membership",
        entityId: membershipId,
        after: {
          userId: user.id,
          status: "ACTIVE",
          displayName: input.displayName,
          email: input.email,
        },
        metadata: { createdVia: "admin_create" },
      });

      const activeBranches = await tx
        .select({ id: coreBranches.id })
        .from(coreBranches)
        .where(
          and(eq(coreBranches.organizationId, actor.organizationId), eq(coreBranches.status, "ACTIVE")),
        );
      const soleBranchId = soleActiveBranchIdForDefaultOperateGrant(activeBranches.map((row) => row.id));
      if (soleBranchId) {
        await tx.insert(coreBranchAccess).values({
          organizationId: actor.organizationId,
          membershipId,
          branchId: soleBranchId,
          accessMode: "OPERATE",
        });
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          branchId: soleBranchId,
          actorUserId: actor.userId,
          action: "core.branch_access.granted",
          entityType: "branch_access",
          entityId: membershipId,
          after: { membershipId, branchId: soleBranchId, accessMode: "OPERATE" },
          metadata: { grantedBy: "sole_active_branch" },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rejectAddMember("already_member", actor.organizationId);
    }
    throw error;
  }

  return { userId: user.id, membershipId };
}

/**
 * Attaches an existing account by email as an INVITED membership. The invited
 * user activates it themselves by selecting the organization (self-consent).
 */
export async function attachUserByEmail(
  db: AppDatabase,
  actor: OrganizationActor,
  input: AttachUserByEmailInput,
): Promise<{ userId: string; membershipId: string }> {
  assertPermission(actor, PERMISSIONS.membershipsManage);

  const user = await findCoreUserByEmail(db, input.email);
  if (!user) {
    rejectAddMember("unknown_email", actor.organizationId);
  }

  const membershipId = createId();
  try {
    await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      await tx.insert(coreOrganizationMemberships).values({
        id: membershipId,
        organizationId: actor.organizationId,
        userId: user.id,
        status: "INVITED",
      });

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "core.membership.invited",
        entityType: "membership",
        entityId: membershipId,
        after: {
          userId: user.id,
          status: "INVITED",
          displayName: user.displayName,
          email: user.email,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rejectAddMember("already_member", actor.organizationId);
    }
    throw error;
  }

  return { userId: user.id, membershipId };
}

/**
 * suspend: INVITED or ACTIVE membership loses access immediately.
 * reactivate: SUSPENDED membership (or a disabled login that is not purged)
 * returns to ACTIVE/INVITED.
 * revoke: suspend membership, disable the Core User, schedule 30-day anonymize.
 */
export async function setMembershipStatus(
  db: AppDatabase,
  actor: OrganizationActor,
  membershipId: string,
  action: "suspend" | "reactivate" | "revoke",
) {
  assertPermission(actor, PERMISSIONS.membershipsManage);
  assertNotSelfMembership(actor, membershipId);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(coreOrganizationMemberships)
      .where(
        and(
          eq(coreOrganizationMemberships.id, membershipId),
          eq(coreOrganizationMemberships.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundError("Membership not found");

    const userRows = await tx
      .select()
      .from(coreUsers)
      .where(eq(coreUsers.id, before.userId))
      .limit(1);
    const person = userRows[0];
    if (!person) throw new NotFoundError("Membership not found");

    let nextStatus: string;
    if (action === "revoke") {
      if (person.status === "DISABLED") throw new ConflictError("Staff access is already revoked");
      nextStatus = "SUSPENDED";
    } else if (action === "suspend") {
      if (before.status === "SUSPENDED") throw new ConflictError("Membership is already suspended");
      nextStatus = "SUSPENDED";
    } else {
      if (isPurgedStaffAccount(person)) throw new ConflictError("This account was removed");
      if (before.status !== "SUSPENDED" && person.status !== "DISABLED") {
        throw new ConflictError("Membership is not suspended");
      }
      nextStatus = before.joinedAt ? "ACTIVE" : "INVITED";
    }

    const updated = await tx
      .update(coreOrganizationMemberships)
      .set({ status: nextStatus })
      .where(eq(coreOrganizationMemberships.id, membershipId))
      .returning();

    if (action === "revoke") {
      const revokedAt = new Date();
      await tx
        .update(coreUsers)
        .set({
          status: "DISABLED",
          accessRevokedAt: revokedAt,
          purgeAfter: staffPurgeAfterFrom(revokedAt),
        })
        .where(eq(coreUsers.id, before.userId));
    } else if (action === "reactivate" && person.status === "DISABLED") {
      await tx
        .update(coreUsers)
        .set({
          status: "ACTIVE",
          accessRevokedAt: null,
          purgeAfter: null,
        })
        .where(eq(coreUsers.id, before.userId));
    }

    if (action === "suspend" || action === "revoke") {
      await assertOrganizationRetainsAdmin(tx, actor.organizationId);
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action:
        action === "revoke"
          ? "core.user.disabled"
          : action === "suspend"
            ? "core.membership.suspended"
            : "core.membership.reactivated",
      entityType: "membership",
      entityId: membershipId,
      before: { status: before.status },
      after: {
        status: nextStatus,
        displayName: person.displayName,
        email: person.email,
        ...(action === "revoke" ? { userStatus: "DISABLED" } : {}),
      },
    });

    return updated[0]!;
  });
}

export async function assignRoleToMembership(
  db: AppDatabase,
  actor: OrganizationActor,
  membershipId: string,
  roleId: string,
) {
  assertPermission(actor, PERMISSIONS.membershipsManage);
  assertNotSelfMembership(actor, membershipId);
  try {
    await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
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

      const roleRows = await tx
        .select({ id: coreRoles.id, code: coreRoles.code, status: coreRoles.status })
        .from(coreRoles)
        .where(and(eq(coreRoles.id, roleId), eq(coreRoles.organizationId, actor.organizationId)))
        .limit(1);
      const role = roleRows[0];
      if (!role) throw new NotFoundError("Role not found in this organization");
      if (role.status !== "ACTIVE") throw new ConflictError("Archived roles cannot be assigned");

      // Anti-escalation: nobody may hand out permissions they do not hold.
      const rolePermissionRows = await tx
        .select({ code: coreRolePermissions.permissionCode })
        .from(coreRolePermissions)
        .where(
          and(
            eq(coreRolePermissions.roleId, roleId),
            eq(coreRolePermissions.organizationId, actor.organizationId),
          ),
        );
      const missing = rolePermissionRows
        .map((row) => row.code)
        .filter((code) => !actor.permissions.includes(code));
      if (missing.length > 0) {
        throw new AuthorizationError(
          `Cannot assign a role granting permissions you do not hold: ${missing.join(", ")}`,
        );
      }

      await tx.insert(coreMembershipRoles).values({
        organizationId: actor.organizationId,
        membershipId,
        roleId,
      });

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "core.membership.role_assigned",
        entityType: "membership",
        entityId: membershipId,
        after: { roleId, roleCode: role.code },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Role is already assigned to this membership");
    }
    throw error;
  }
}

export async function removeRoleFromMembership(
  db: AppDatabase,
  actor: OrganizationActor,
  membershipId: string,
  roleId: string,
) {
  assertPermission(actor, PERMISSIONS.membershipsManage);
  assertNotSelfMembership(actor, membershipId);
  await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const deleted = await tx
      .delete(coreMembershipRoles)
      .where(
        and(
          eq(coreMembershipRoles.organizationId, actor.organizationId),
          eq(coreMembershipRoles.membershipId, membershipId),
          eq(coreMembershipRoles.roleId, roleId),
        ),
      )
      .returning();
    if (deleted.length === 0) throw new NotFoundError("Role assignment not found");

    await assertOrganizationRetainsAdmin(tx, actor.organizationId);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.membership.role_removed",
      entityType: "membership",
      entityId: membershipId,
      before: { roleId },
    });
  });
}

/** Effective permissions of a membership: union across its ACTIVE roles. */
export async function loadEffectivePermissions(
  tx: AppDatabase,
  organizationId: string,
  membershipId: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ code: coreRolePermissions.permissionCode })
    .from(coreMembershipRoles)
    .innerJoin(
      coreRoles,
      and(eq(coreRoles.id, coreMembershipRoles.roleId), eq(coreRoles.status, "ACTIVE")),
    )
    .innerJoin(coreRolePermissions, eq(coreRolePermissions.roleId, coreRoles.id))
    .where(
      and(
        eq(coreMembershipRoles.organizationId, organizationId),
        eq(coreMembershipRoles.membershipId, membershipId),
      ),
    );
  return rows.map((row) => row.code);
}

/** Explicit branch grants of a membership. */
export async function loadBranchAccess(
  tx: AppDatabase,
  organizationId: string,
  membershipId: string,
): Promise<Array<{ branchId: string; accessMode: string }>> {
  return tx
    .select({ branchId: coreBranchAccess.branchId, accessMode: coreBranchAccess.accessMode })
    .from(coreBranchAccess)
    .where(
      and(
        eq(coreBranchAccess.organizationId, organizationId),
        eq(coreBranchAccess.membershipId, membershipId),
      ),
    );
}
