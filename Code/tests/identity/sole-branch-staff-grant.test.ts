import { describe, expect, it } from "vitest";
import {
  createBranch,
  createUserWithMembership,
  soleActiveBranchIdForDefaultOperateGrant,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
} from "../helpers/identity";

describe("sole-branch default operate grant", () => {
  it("returns the only id when exactly one active branch exists", () => {
    expect(soleActiveBranchIdForDefaultOperateGrant([])).toBeNull();
    expect(soleActiveBranchIdForDefaultOperateGrant(["a", "b"])).toBeNull();
    expect(soleActiveBranchIdForDefaultOperateGrant(["only"])).toBe("only");
  });

  it("grants OPERATE on the sole ACTIVE branch when staff is created", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@sole.com",
      name: "Owner Sole",
      slug: "sole-br",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { name: "Main" });
    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "ops@sole.com", password: "password-123", displayName: "Ops" },
      createAuthAccountProvisioner(env.auth),
    );
    void staff;
    const headers = await signInHeaders(env.auth, { email: "ops@sole.com", password: "password-123" });
    const staffContext = await resolveActor(env, headers, owner.organizationId);
    expect(staffContext.actor.branchAccess).toEqual([{ branchId: branch.id, accessMode: "OPERATE" }]);
  });

  it("does not grant every branch when more than one ACTIVE branch exists", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@multi.com",
      name: "Owner Multi",
      slug: "multi-br",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    await createBranch(env.db, ownerContext.actor, { name: "One" });
    await createBranch(env.db, ownerContext.actor, { name: "Two" });
    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "ops@multi.com", password: "password-123", displayName: "Ops" },
      createAuthAccountProvisioner(env.auth),
    );
    void staff;
    const headers = await signInHeaders(env.auth, { email: "ops@multi.com", password: "password-123" });
    const staffContext = await resolveActor(env, headers, owner.organizationId);
    expect(staffContext.actor.branchAccess).toEqual([]);
  });
});
