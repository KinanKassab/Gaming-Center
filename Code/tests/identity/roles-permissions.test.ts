import { describe, expect, it } from "vitest";
import {
  AdminInvariantError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/core/errors";
import {
  archiveRole,
  assignRoleToMembership,
  createBranch,
  createRole,
  createUserWithMembership,
  listRoles,
  removeRoleFromMembership,
  setMembershipStatus,
  setRolePermissions,
  updateRole,
  PERMISSIONS,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import { CANNOT_MODIFY_SELF_REASON } from "@/modules/identity/self-guard";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
  type TestEnvironment,
  type SeededOwner,
} from "../helpers/identity";

async function seedMember(
  env: TestEnvironment,
  owner: SeededOwner,
  email: string,
  displayName: string,
) {
  const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
  const created = await createUserWithMembership(
    env.db,
    ownerContext.actor,
    { email, password: "password-123", displayName },
    createAuthAccountProvisioner(env.auth),
  );
  const headers = await signInHeaders(env.auth, { email, password: "password-123" });
  return { ...created, headers };
}

describe("roles and permissions", () => {
  it("permission granted allows the operation; permission absent rejects it", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const member = await seedMember(env, owner, "staff@a.com", "Staff");
    const branchManagerRole = await createRole(env.db, ownerContext.actor, {
      code: "BRANCH_MANAGER",
      name: "Branch manager",
    });
    await setRolePermissions(env.db, ownerContext.actor, branchManagerRole.id, {
      permissionCodes: [PERMISSIONS.branchesRead, PERMISSIONS.branchesManage],
    });

    // Before the role: no permission -> rejected (server-side, direct call).
    const before = await resolveActor(env, member.headers, owner.organizationId);
    await expect(
      createBranch(env.db, before.actor, { code: "JRM", name: "Jaramana" }),
    ).rejects.toThrow(AuthorizationError);

    await assignRoleToMembership(env.db, ownerContext.actor, member.membershipId, branchManagerRole.id);

    // After the role: allowed.
    const after = await resolveActor(env, member.headers, owner.organizationId);
    const branch = await createBranch(env.db, after.actor, { code: "JRM", name: "Jaramana" });
    expect(branch.code).toBe("JRM");

    // Still cannot manage roles.
    await expect(
      createRole(env.db, after.actor, { code: "X", name: "X" }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("a role from organization A cannot be used inside organization B", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "org-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);

    const roleInA = await createRole(env.db, contextA.actor, { code: "HELPER", name: "Helper" });
    const memberB = await seedMember(env, ownerB, "staff-b@b.com", "Staff B");

    // Application check: role id from A is invisible/rejected inside B.
    await expect(
      assignRoleToMembership(env.db, contextB.actor, memberB.membershipId, roleInA.id),
    ).rejects.toThrow(NotFoundError);

    // Database backstop: composite FK rejects the cross-tenant pair even with raw SQL.
    await expect(
      env.client.query(
        `INSERT INTO core_membership_roles (organization_id, membership_id, role_id)
         VALUES ($1, $2, $3)`,
        [ownerB.organizationId, ownerB.membershipId, roleInA.id],
      ),
    ).rejects.toThrow();
  });

  it("archived roles stop contributing permissions", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const member = await seedMember(env, owner, "staff@a.com", "Staff");

    const role = await createRole(env.db, ownerContext.actor, { code: "READER", name: "Reader" });
    await setRolePermissions(env.db, ownerContext.actor, role.id, {
      permissionCodes: [PERMISSIONS.branchesRead],
    });
    await assignRoleToMembership(env.db, ownerContext.actor, member.membershipId, role.id);

    const withRole = await resolveActor(env, member.headers, owner.organizationId);
    expect(withRole.actor.permissions).toContain(PERMISSIONS.branchesRead);

    await archiveRole(env.db, ownerContext.actor, role.id);

    const afterArchive = await resolveActor(env, member.headers, owner.organizationId);
    expect(afterArchive.actor.permissions).not.toContain(PERMISSIONS.branchesRead);
  });

  it("system (OWNER) role cannot be renamed, archived, or have its permissions edited", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    await expect(
      updateRole(env.db, ownerContext.actor, owner.ownerRoleId, { name: "Not owner" }),
    ).rejects.toThrow(ConflictError);
    await expect(archiveRole(env.db, ownerContext.actor, owner.ownerRoleId)).rejects.toThrow(
      ConflictError,
    );
    await expect(
      setRolePermissions(env.db, ownerContext.actor, owner.ownerRoleId, { permissionCodes: [] }),
    ).rejects.toThrow(ConflictError);
    await expect(
      setRolePermissions(env.db, ownerContext.actor, "00000000-0000-7000-8000-000000000000", {
        permissionCodes: [],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("setRolePermissions replaces the whole set and validates codes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const role = await createRole(env.db, ownerContext.actor, { code: "MIXED", name: "Mixed" });
    await setRolePermissions(env.db, ownerContext.actor, role.id, {
      permissionCodes: [PERMISSIONS.branchesRead, PERMISSIONS.branchesManage],
    });
    await setRolePermissions(env.db, ownerContext.actor, role.id, {
      permissionCodes: [PERMISSIONS.branchesRead],
    });

    const roles = await listRoles(env.db, ownerContext.actor);
    const mixed = roles.find((row) => row.code === "MIXED");
    expect(mixed?.permissionCodes).toEqual([PERMISSIONS.branchesRead]);

    await expect(
      setRolePermissions(env.db, ownerContext.actor, role.id, {
        permissionCodes: ["gaming.sessions.discount"],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("nobody can grant permissions they do not hold (anti-escalation)", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    // Delegated admin: can manage users and roles, but not the organization profile.
    const adminRole = await createRole(env.db, ownerContext.actor, {
      code: "DELEGATED_ADMIN",
      name: "Delegated admin",
    });
    await setRolePermissions(env.db, ownerContext.actor, adminRole.id, {
      permissionCodes: [
        PERMISSIONS.membershipsRead,
        PERMISSIONS.membershipsManage,
        PERMISSIONS.rolesRead,
        PERMISSIONS.rolesManage,
      ],
    });
    const admin = await seedMember(env, owner, "admin@a.com", "Delegated");
    await assignRoleToMembership(env.db, ownerContext.actor, admin.membershipId, adminRole.id);
    const adminContext = await resolveActor(env, admin.headers, owner.organizationId);

    // 1. Cannot edit a role to include a permission they lack.
    const target = await createRole(env.db, adminContext.actor, { code: "TARGET", name: "T" });
    await expect(
      setRolePermissions(env.db, adminContext.actor, target.id, {
        permissionCodes: [PERMISSIONS.organizationsManage],
      }),
    ).rejects.toThrow(AuthorizationError);

    // 2. Cannot assign a role that carries permissions they lack (e.g. OWNER).
    const targetMember = await seedMember(env, owner, "target@a.com", "Target");
    await expect(
      assignRoleToMembership(
        env.db,
        adminContext.actor,
        targetMember.membershipId,
        owner.ownerRoleId,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects self membership mutations before last-admin checks", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-self",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    await expect(
      removeRoleFromMembership(env.db, ownerContext.actor, owner.membershipId, owner.ownerRoleId),
    ).rejects.toMatchObject({ reason: CANNOT_MODIFY_SELF_REASON });
    await expect(
      setMembershipStatus(env.db, ownerContext.actor, owner.membershipId, "suspend"),
    ).rejects.toMatchObject({ reason: CANNOT_MODIFY_SELF_REASON });
    await expect(
      assignRoleToMembership(env.db, ownerContext.actor, owner.membershipId, owner.ownerRoleId),
    ).rejects.toMatchObject({ reason: CANNOT_MODIFY_SELF_REASON });
  });

  it("the last active administrator cannot be stripped by another member", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const staff = await createStaffMember(env, owner, {
      email: "staff@a.com",
      displayName: "Staff",
      roleCode: "STAFF_MGR",
      permissions: [PERMISSIONS.membershipsManage],
    });
    const staffContext = await resolveActor(env, staff.headers, owner.organizationId);

    await expect(
      setMembershipStatus(env.db, staffContext.actor, owner.membershipId, "suspend"),
    ).rejects.toThrow(AdminInvariantError);
    await expect(
      removeRoleFromMembership(env.db, staffContext.actor, owner.membershipId, owner.ownerRoleId),
    ).rejects.toThrow(AdminInvariantError);
    expect(ownerContext.actor.permissions).toContain(PERMISSIONS.membershipsManage);
  });

  it("the last remaining admin role cannot be archived or stripped", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-last-role",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const adminRole = await createRole(env.db, ownerContext.actor, {
      code: "SECOND_ADMIN",
      name: "Second admin",
    });
    await setRolePermissions(env.db, ownerContext.actor, adminRole.id, {
      permissionCodes: [PERMISSIONS.membershipsManage, PERMISSIONS.rolesManage],
    });
    const second = await seedMember(env, owner, "admin2@a.com", "Admin Two");
    await assignRoleToMembership(env.db, ownerContext.actor, second.membershipId, adminRole.id);
    const secondContext = await resolveActor(env, second.headers, owner.organizationId);
    await removeRoleFromMembership(env.db, secondContext.actor, owner.membershipId, owner.ownerRoleId);

    await expect(archiveRole(env.db, secondContext.actor, adminRole.id)).rejects.toThrow(AdminInvariantError);
    await expect(
      setRolePermissions(env.db, secondContext.actor, adminRole.id, {
        permissionCodes: [PERMISSIONS.rolesManage],
      }),
    ).rejects.toThrow(AdminInvariantError);
  });

  it("overlapping last-admin removals cannot both commit", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-race",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const second = await seedMember(env, owner, "admin2@a.com", "Admin Two");
    await assignRoleToMembership(env.db, ownerContext.actor, second.membershipId, owner.ownerRoleId);
    const secondContext = await resolveActor(env, second.headers, owner.organizationId);

    const results = await Promise.allSettled([
      setMembershipStatus(env.db, ownerContext.actor, second.membershipId, "suspend"),
      setMembershipStatus(env.db, secondContext.actor, owner.membershipId, "suspend"),
    ]);

    const succeeded = results.filter((result) => result.status === "fulfilled");
    expect(succeeded.length).toBeLessThan(2);

    const stillAdmin = await Promise.allSettled([
      resolveActor(env, owner.headers, owner.organizationId),
      resolveActor(env, second.headers, owner.organizationId),
    ]);
    const activeAdmins = stillAdmin.filter((result) => result.status === "fulfilled");
    expect(activeAdmins.length).toBeGreaterThanOrEqual(1);
  });

  it("duplicate role assignment is rejected", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const second = await seedMember(env, owner, "dup@a.com", "Dup");
    await assignRoleToMembership(env.db, ownerContext.actor, second.membershipId, owner.ownerRoleId);
    await expect(
      assignRoleToMembership(env.db, ownerContext.actor, second.membershipId, owner.ownerRoleId),
    ).rejects.toThrow(ConflictError);
  });
});
