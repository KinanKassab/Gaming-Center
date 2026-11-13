/** Branch grants are only meaningful when the organization has more than one place,
 * or when a non-owner still has no grant (repair path, including a single branch). */
export function shouldShowStaffBranchControls(input: {
  activeBranchCount: number;
  isOwner: boolean;
  grantCount: number;
}): boolean {
  if (input.isOwner) return false;
  if (input.activeBranchCount <= 0) return false;
  if (input.activeBranchCount > 1) return true;
  return input.grantCount === 0;
}

/** Staff administer other people; they never edit their own membership here. */
export function canEditStaffMembership(actorMembershipId: string, targetMembershipId: string): boolean {
  return actorMembershipId !== targetMembershipId;
}

export function membershipHasOwnerRole(roles: ReadonlyArray<{ code: string }>): boolean {
  return roles.some((role) => role.code === "OWNER");
}
