export type PermissionCatalogItem = {
  code: string;
  module: string;
  name: string;
  description: string | null;
};

export type PermissionCatalogGroup = {
  module: string;
  permissions: PermissionCatalogItem[];
};

/** Groups catalog rows by their source `module` column, preserving first-seen module order. */
export function groupPermissionCatalog(rows: readonly PermissionCatalogItem[]): PermissionCatalogGroup[] {
  const order: string[] = [];
  const byModule = new Map<string, PermissionCatalogItem[]>();
  for (const row of rows) {
    const existing = byModule.get(row.module);
    if (!existing) {
      order.push(row.module);
      byModule.set(row.module, [row]);
    } else {
      existing.push(row);
    }
  }
  return order.map((module) => ({
    module,
    permissions: byModule.get(module) ?? [],
  }));
}

export function allPermissionCodes(rows: readonly PermissionCatalogItem[]): string[] {
  return rows.map((row) => row.code);
}

/** If every group code is selected, remove them; otherwise add the whole group. */
export function togglePermissionGroup(
  selected: ReadonlySet<string>,
  groupCodes: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const allOn = groupCodes.length > 0 && groupCodes.every((code) => next.has(code));
  if (allOn) {
    for (const code of groupCodes) next.delete(code);
  } else {
    for (const code of groupCodes) next.add(code);
  }
  return next;
}

export function permissionGroupFullySelected(
  selected: ReadonlySet<string>,
  groupCodes: readonly string[],
): boolean {
  return groupCodes.length > 0 && groupCodes.every((code) => selected.has(code));
}
