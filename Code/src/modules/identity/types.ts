import type { BranchAccessMode } from "@/core/tenancy";

/**
 * Fully resolved acting identity for organization-scoped operations:
 * authenticated core user + validated ACTIVE membership + effective
 * permissions + explicit branch grants. Built by the authorization pipeline
 * (src/auth/context.ts); never from client-supplied values.
 */
export type OrganizationActor = {
  userId: string;
  organizationId: string;
  membershipId: string;
  permissions: ReadonlyArray<string>;
  branchAccess: ReadonlyArray<{ branchId: string; accessMode: BranchAccessMode }>;
};

/** Registry of permission codes seeded by migrations. */
export const PERMISSIONS = {
  organizationsRead: "core.organizations.read",
  organizationsManage: "core.organizations.manage",
  branchesRead: "core.branches.read",
  branchesManage: "core.branches.manage",
  membershipsRead: "core.memberships.read",
  membershipsManage: "core.memberships.manage",
  rolesRead: "core.roles.read",
  rolesManage: "core.roles.manage",
  settingsRead: "core.settings.read",
  settingsManage: "core.settings.manage",
  customersRead: "core.customers.read",
  customersManage: "core.customers.manage",
  auditRead: "core.audit.read",
  gamingMasterRead: "gaming.master.read",
  gamingMasterManage: "gaming.master.manage",
  gamingSessionsRead: "gaming.sessions.read",
  gamingSessionsStart: "gaming.sessions.start",
  gamingSessionsOperate: "gaming.sessions.operate",
  gamingSessionsCancel: "gaming.sessions.cancel",
  financePaymentsRead: "finance.payments.read",
  financePaymentsCreate: "finance.payments.create",
  financeExpensesRead: "finance.expenses.read",
  financeExpensesCreate: "finance.expenses.create",
  posCatalogRead: "pos.catalog.read",
  posCatalogManage: "pos.catalog.manage",
  posOrdersRead: "pos.orders.read",
  posOrdersCreate: "pos.orders.create",
} as const;

/**
 * An organization must always keep at least one ACTIVE membership (of an
 * ACTIVE user) whose effective permissions include all of these codes.
 * See admin-guard.ts.
 */
export const ADMIN_CRITICAL_PERMISSIONS: ReadonlyArray<string> = [
  PERMISSIONS.membershipsManage,
  PERMISSIONS.rolesManage,
];

export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

/** Port implemented by the auth layer: creates a login account and returns the stable subject. */
export type AuthAccountProvisioner = (input: {
  email: string;
  password: string;
  name: string;
}) => Promise<{ authSubject: string }>;
