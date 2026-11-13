/**
 * Keep a controlled select value aligned with available option ids.
 *
 * - If the current id is still in the list, keep it (do not clobber an explicit choice).
 * - If it is empty or stale and options exist, take the first option.
 * - If there are no options, return "".
 *
 * Visible selected UI and submitted id must never disagree (BUG-003).
 */
export function syncSelectedId(currentId: string, optionIds: readonly string[]): string {
  if (currentId && optionIds.includes(currentId)) return currentId;
  return optionIds[0] ?? "";
}

export function selectedIdOrNull(currentId: string, optionIds: readonly string[]): string | null {
  const next = syncSelectedId(currentId, optionIds);
  return next.length > 0 ? next : null;
}
