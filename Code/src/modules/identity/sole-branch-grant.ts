/** When a new member is created, grant OPERATE only if exactly one ACTIVE branch exists. */
export function soleActiveBranchIdForDefaultOperateGrant(
  activeBranchIds: readonly string[],
): string | null {
  return activeBranchIds.length === 1 ? (activeBranchIds[0] ?? null) : null;
}
