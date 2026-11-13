import { describe, expect, it } from "vitest";
import { assertBranchAccess, assertPermission, resolveOrganizationId } from "@/core/tenancy";
import { AuthorizationError, TenantIsolationError } from "@/core/errors";

const session = {
  userId: "user-1",
  organizationId: "org-a",
  branchAccess: [{ branchId: "branch-1", accessMode: "OPERATE" as const }],
  permissions: ["core.customers.read"],
};

describe("tenant session guards", () => {
  it("uses the session organization, not a client-supplied tenant", () => {
    expect(resolveOrganizationId(session)).toBe("org-a");
    expect(resolveOrganizationId(session, "org-a")).toBe("org-a");
  });

  it("rejects a client organization id that does not match the session", () => {
    expect(() => resolveOrganizationId(session, "org-b")).toThrow(TenantIsolationError);
  });

  it("enforces permissions and branch access", () => {
    expect(() => assertPermission(session, "core.customers.read")).not.toThrow();
    expect(() => assertPermission(session, "core.roles.manage")).toThrow(AuthorizationError);
    expect(() => assertBranchAccess(session, "branch-1", "VIEW")).not.toThrow();
    expect(() => assertBranchAccess(session, "branch-1", "MANAGE")).toThrow(AuthorizationError);
    expect(() => assertBranchAccess(session, "branch-other", "VIEW")).toThrow(AuthorizationError);
  });
});
