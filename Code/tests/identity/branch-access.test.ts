import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError } from "@/core/errors";
import { assertBranchAccess } from "@/core/tenancy";
import {
  archiveBranch,
  createBranch,
  createUserWithMembership,
  grantBranchAccess,
  revokeBranchAccess,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
} from "../helpers/identity";

describe("branch access", () => {
  it("multi-branch user can access exactly the explicitly granted branches, honoring modes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const jaramana = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const mezzeh = await createBranch(env.db, ownerContext.actor, { code: "MZH", name: "Mezzeh" });
    const shaalan = await createBranch(env.db, ownerContext.actor, { code: "SHL", name: "Shaalan" });

    const manager = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "ahmad@a.com", password: "password-123", displayName: "Ahmad" },
      createAuthAccountProvisioner(env.auth),
    );
    await grantBranchAccess(env.db, ownerContext.actor, manager.membershipId, jaramana.id, {
      accessMode: "MANAGE",
    });
    await grantBranchAccess(env.db, ownerContext.actor, manager.membershipId, mezzeh.id, {
      accessMode: "OPERATE",
    });

    const managerHeaders = await signInHeaders(env.auth, {
      email: "ahmad@a.com",
      password: "password-123",
    });
    const managerContext = await resolveActor(env, managerHeaders, owner.organizationId);
    const actor = managerContext.actor;

    expect(actor.branchAccess).toHaveLength(2);

    // Authorized branches work at or below the granted mode.
    expect(() => assertBranchAccess(actor, jaramana.id, "MANAGE")).not.toThrow();
    expect(() => assertBranchAccess(actor, mezzeh.id, "OPERATE")).not.toThrow();
    expect(() => assertBranchAccess(actor, mezzeh.id, "VIEW")).not.toThrow();

    // Above the granted mode fails.
    expect(() => assertBranchAccess(actor, mezzeh.id, "MANAGE")).toThrow(AuthorizationError);

    // Branch without any grant fails.
    expect(() => assertBranchAccess(actor, shaalan.id, "VIEW")).toThrow(AuthorizationError);
  });

  it("branch creation grants the creator MANAGE access automatically", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });

    const refreshed = await resolveActor(env, owner.headers, owner.organizationId);
    expect(refreshed.actor.branchAccess).toContainEqual({
      branchId: branch.id,
      accessMode: "MANAGE",
    });
  });

  it("cannot grant access to a branch of another organization", async () => {
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
    const branchB = await createBranch(env.db, contextB.actor, { code: "B1", name: "Branch B" });

    const staffA = await createUserWithMembership(
      env.db,
      contextA.actor,
      { email: "staff-a@a.com", password: "password-123", displayName: "Staff A" },
      createAuthAccountProvisioner(env.auth),
    );

    // Application check: branch of org B is invisible inside org A.
    await expect(
      grantBranchAccess(env.db, contextA.actor, staffA.membershipId, branchB.id, {
        accessMode: "VIEW",
      }),
    ).rejects.toThrow(NotFoundError);

    // Database backstop: composite FK rejects the cross-tenant pair via raw SQL.
    await expect(
      env.client.query(
        `INSERT INTO core_branch_access (organization_id, membership_id, branch_id, access_mode)
         VALUES ($1, $2, $3, 'VIEW')`,
        [ownerA.organizationId, ownerA.membershipId, branchB.id],
      ),
    ).rejects.toThrow();
  });

  it("revoking access removes it from the resolved context", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });

    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "staff@a.com", password: "password-123", displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    await grantBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id, {
      accessMode: "OPERATE",
    });
    const staffHeaders = await signInHeaders(env.auth, {
      email: "staff@a.com",
      password: "password-123",
    });

    const before = await resolveActor(env, staffHeaders, owner.organizationId);
    expect(before.actor.branchAccess).toHaveLength(1);

    await revokeBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id);

    const after = await resolveActor(env, staffHeaders, owner.organizationId);
    expect(after.actor.branchAccess).toHaveLength(0);

    await expect(
      revokeBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id),
    ).rejects.toThrow(NotFoundError);
  });

  it("re-granting updates the mode instead of duplicating the row", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });

    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "staff@a.com", password: "password-123", displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    await grantBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id, {
      accessMode: "VIEW",
    });
    await grantBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id, {
      accessMode: "MANAGE",
    });

    const staffHeaders = await signInHeaders(env.auth, {
      email: "staff@a.com",
      password: "password-123",
    });
    const context = await resolveActor(env, staffHeaders, owner.organizationId);
    expect(context.actor.branchAccess).toEqual([{ branchId: branch.id, accessMode: "MANAGE" }]);
  });

  it("archived branches cannot receive new grants", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    await archiveBranch(env.db, ownerContext.actor, branch.id);

    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "staff@a.com", password: "password-123", displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    await expect(
      grantBranchAccess(env.db, ownerContext.actor, staff.membershipId, branch.id, {
        accessMode: "VIEW",
      }),
    ).rejects.toThrow(ConflictError);
  });
});
