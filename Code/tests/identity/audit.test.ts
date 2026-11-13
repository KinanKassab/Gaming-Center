import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/core/errors";
import {
  createBranch,
  createRole,
  createUserWithMembership,
  grantBranchAccess,
  listAuditLogs,
  revokeBranchAccess,
  setMembershipStatus,
  setRolePermissions,
  PERMISSIONS,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
} from "../helpers/identity";

describe("audit trail", () => {
  it("identity/admin mutations produce audit records answering who/what/where/when", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const actor = ownerContext.actor;

    const branch = await createBranch(env.db, actor, { code: "JRM", name: "Jaramana" });
    const role = await createRole(env.db, actor, { code: "CASHIER", name: "Cashier" });
    await setRolePermissions(env.db, actor, role.id, {
      permissionCodes: [PERMISSIONS.branchesRead],
    });
    const secretPassword = "super-secret-password-1";
    const staff = await createUserWithMembership(
      env.db,
      actor,
      { email: "staff@a.com", password: secretPassword, displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    await grantBranchAccess(env.db, actor, staff.membershipId, branch.id, { accessMode: "VIEW" });
    await revokeBranchAccess(env.db, actor, staff.membershipId, branch.id);
    await setMembershipStatus(env.db, actor, staff.membershipId, "suspend");

    const logs = await listAuditLogs(env.db, actor, { limit: 100 });
    const actions = logs.map((row) => row.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        "core.organization.created",
        "core.branch.created",
        "core.role.created",
        "core.role.permissions_set",
        "core.user.created",
        "core.membership.created",
        "core.branch_access.granted",
        "core.branch_access.revoked",
        "core.membership.suspended",
      ]),
    );

    // Every record answers: who, which organization, what, when.
    for (const log of logs) {
      expect(log.organizationId).toBe(owner.organizationId);
      expect(log.actorUserId).toBe(owner.userId);
      expect(log.entityType).toBeTruthy();
      expect(log.occurredAt).toBeInstanceOf(Date);
    }

    // Branch-scoped events carry the branch context.
    const grantLog = logs.find((row) => row.action === "core.branch_access.granted");
    expect(grantLog?.branchId).toBe(branch.id);

    // Suspension captures before/after status.
    const suspendLog = logs.find((row) => row.action === "core.membership.suspended");
    expect(suspendLog?.beforeData).toEqual({ status: "ACTIVE" });
    expect(suspendLog?.afterData).toMatchObject({ status: "SUSPENDED", displayName: "Staff" });

    // No secrets anywhere in the audit trail.
    expect(JSON.stringify(logs)).not.toContain(secretPassword);
  });

  it("audit rows are append-only even for privileged application queries", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });

    await env.client.query(`SELECT set_config('app.organization_id', $1, false)`, [
      owner.organizationId,
    ]);
    await expect(
      env.client.query(`UPDATE core_audit_logs SET action = 'tampered'`),
    ).rejects.toThrow(/append-only|permission denied/);
    await expect(env.client.query(`DELETE FROM core_audit_logs`)).rejects.toThrow(
      /append-only|permission denied/,
    );
  });

  it("reading the audit log requires the audit permission", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const staff = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "staff@a.com", password: "password-123", displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    expect(staff.membershipId).toBeTruthy();
    const staffHeaders = await signInHeaders(env.auth, {
      email: "staff@a.com",
      password: "password-123",
    });
    const staffContext = await resolveActor(env, staffHeaders, owner.organizationId);

    await expect(listAuditLogs(env.db, staffContext.actor)).rejects.toThrow(AuthorizationError);
  });
});
