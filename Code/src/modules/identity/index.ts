/**
 * Identity module — core users, organization memberships, roles, permissions,
 * branch access, and the audit trail for identity/admin mutations.
 *
 * Every mutation here authenticates nothing by itself: callers must pass an
 * OrganizationActor produced by the authorization pipeline (src/auth/context.ts).
 * Use-cases then enforce permissions, tenant scope, invariants, and audit.
 */
export {
  PERMISSIONS,
  ADMIN_CRITICAL_PERMISSIONS,
  type OrganizationActor,
  type MembershipStatus,
  type AuthAccountProvisioner,
} from "@/modules/identity/types";

export {
  ensureCoreUser,
  findCoreUserByAuthSubject,
  findCoreUserByEmail,
  touchLastLogin,
  applyDueStaffPurge,
  staffPurgeAfterFrom,
  isPurgedStaffAccount,
  STAFF_ACCESS_PURGE_MS,
  PURGED_STAFF_DISPLAY_NAME,
  type CoreUser,
} from "@/modules/identity/core-user";

export {
  createOrganization,
  createOrganizationInputSchema,
  appLocaleSchema,
  getOrganizationProfile,
  updateOrganizationProfile,
  updateOrganizationInputSchema,
  listUserMemberships,
  activateInvitedMembership,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type UserMembershipSummary,
} from "@/modules/identity/organizations";

export {
  listBranches,
  createBranch,
  createBranchInputSchema,
  updateBranch,
  updateBranchInputSchema,
  archiveBranch,
  BRANCH_NAME_IN_USE_REASON,
  type CreateBranchInput,
  type UpdateBranchInput,
} from "@/modules/identity/branches";

export {
  listMemberships,
  createUserWithMembership,
  createUserWithMembershipInputSchema,
  attachUserByEmail,
  attachUserByEmailInputSchema,
  setMembershipStatus,
  assignRoleToMembership,
  removeRoleFromMembership,
  loadEffectivePermissions,
  loadBranchAccess,
  ADD_MEMBER_REJECTED_MESSAGE,
  type CreateUserWithMembershipInput,
  type AttachUserByEmailInput,
  type MembershipSummary,
} from "@/modules/identity/memberships";

export { soleActiveBranchIdForDefaultOperateGrant } from "@/modules/identity/sole-branch-grant";

export {
  listRoles,
  listPermissionCatalog,
  createRole,
  createRoleInputSchema,
  updateRole,
  updateRoleInputSchema,
  archiveRole,
  setRolePermissions,
  setRolePermissionsInputSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
  type SetRolePermissionsInput,
  type RoleSummary,
} from "@/modules/identity/roles";

export {
  grantBranchAccess,
  grantBranchAccessInputSchema,
  revokeBranchAccess,
  type GrantBranchAccessInput,
} from "@/modules/identity/branch-access";

export { listAuditLogs, recordAudit, type AuditEntry } from "@/modules/identity/audit";

export {
  assertNotSelfMembership,
  CANNOT_MODIFY_SELF_MESSAGE,
  CANNOT_MODIFY_SELF_REASON,
} from "@/modules/identity/self-guard";

export { assertOrganizationRetainsAdmin } from "@/modules/identity/admin-guard";

export {
  assertInitialOrganizationCreateAllowed,
  claimHttpSignupSlot,
  completeHttpSignupClaim,
  hasAnyCoreUser,
  isFirstUserRequired,
  isPlatformOrganizationClaimRequired,
  readPlatformBootstrap,
  recordInitialOrganizationId,
  releaseHttpSignupClaim,
  runWithPlatformOrganizationClaim,
} from "@/modules/identity/platform-bootstrap";
