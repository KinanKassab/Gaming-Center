import { AuthorizationError, TenantIsolationError } from "@/core/errors";

export type BranchAccessMode = "VIEW" | "OPERATE" | "MANAGE";

export type SessionTenant = {
  userId: string;
  organizationId: string;
  branchAccess: ReadonlyArray<{ branchId: string; accessMode: BranchAccessMode }>;
  permissions: ReadonlyArray<string>;
};

const ACCESS_RANK: Record<BranchAccessMode, number> = {
  VIEW: 1,
  OPERATE: 2,
  MANAGE: 3,
};

/**
 * The session organization always wins. A client-supplied organization id
 * may only match the session; it never selects the tenant.
 */
export function resolveOrganizationId(
  session: SessionTenant,
  clientOrganizationId?: string,
): string {
  if (clientOrganizationId && clientOrganizationId !== session.organizationId) {
    throw new TenantIsolationError("Client organization does not match the session");
  }
  return session.organizationId;
}

export function assertPermission(session: SessionTenant, permission: string): void {
  if (!session.permissions.includes(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
}

/**
 * Required for every operation that targets branch-owned data.
 * Call this after organization resolution whenever the operation's subject
 * is a branch or branch-owned row (settings overrides, areas, devices, …).
 */
export function assertBranchAccess(
  session: SessionTenant,
  branchId: string,
  minimum: BranchAccessMode,
): void {
  const grant = session.branchAccess.find((row) => row.branchId === branchId);
  if (!grant || ACCESS_RANK[grant.accessMode] < ACCESS_RANK[minimum]) {
    throw new AuthorizationError("Branch access denied");
  }
}
