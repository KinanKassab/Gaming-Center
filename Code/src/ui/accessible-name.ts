/**
 * Accessible-name helpers (BUG-020).
 * One visible label names the control. Helpers/errors are descriptions.
 */

export function joinDescribedBy(...ids: Array<string | null | undefined | false>): string | undefined {
  const parts: string[] = [];
  for (const value of ids) {
    if (typeof value !== "string") continue;
    for (const token of value.split(/\s+/)) {
      const id = token.trim();
      if (id && !parts.includes(id)) parts.push(id);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function hasDuplicateAccessibleName(input: {
  visibleLabel: string | null | undefined;
  ariaLabel: string | null | undefined;
}): boolean {
  const visible = input.visibleLabel?.trim() ?? "";
  const aria = input.ariaLabel?.trim() ?? "";
  if (!visible || !aria) return false;
  const vis = visible.toLowerCase();
  const name = aria.toLowerCase();
  return name === vis || name.includes(vis) || vis.includes(name);
}

/** Prefer a visible <label htmlFor> over aria-label on the same control. */
export function shouldOmitAriaLabelWhenVisibleLabelExists(hasVisibleLabel: boolean, ariaLabel: string | null | undefined): boolean {
  return hasVisibleLabel && Boolean(ariaLabel && ariaLabel.trim());
}
