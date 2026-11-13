/**
 * Operational branch picker defaults. Floor is always one concrete branch.
 * Reports may omit branchId (all accessible branches) when the report query
 * supports that. Do not invent a persisted global branch cookie here.
 *
 * When the operator can see only one branch, hide the branch field and use
 * that branch. The field returns if a second branch is added or granted.
 */

export function shouldShowBranchPicker(branchCount: number): boolean {
  return branchCount > 1;
}

export function soleBranchId(branches: ReadonlyArray<{ id: string }>): string | undefined {
  return branches.length === 1 ? branches[0]?.id : undefined;
}

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Gaming Floor default:
 * 1. valid explicit branchId from the URL
 * 2. first accessible branch that has devices (operational data)
 * 3. first accessible branch in the caller’s stable list order
 *
 * A newly created empty branch must not hide a working floor unless the
 * operator explicitly selected it.
 */
export function resolveFloorBranchId(input: {
  requestedBranchId: string | undefined;
  accessibleBranchIds: readonly string[];
  branchIdsWithDevices: readonly string[];
}): string | undefined {
  const accessible = input.accessibleBranchIds;
  const requested = input.requestedBranchId?.trim() ?? "";
  if (requested && accessible.includes(requested)) return requested;
  const withDevices = accessible.filter((id) => input.branchIdsWithDevices.includes(id));
  return withDevices[0] ?? accessible[0];
}

/**
 * Reports default: All accessible branches unless a valid explicit branchId
 * is present. Stale or inaccessible ids do not silently select another branch.
 */
export function resolveReportBranchId(
  requestedBranchId: string | undefined,
  accessibleBranchIds: readonly string[],
): string | undefined {
  const requested = requestedBranchId?.trim() ?? "";
  if (requested && accessibleBranchIds.includes(requested)) return requested;
  return undefined;
}
