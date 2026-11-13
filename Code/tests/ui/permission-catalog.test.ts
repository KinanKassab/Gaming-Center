import { describe, expect, it } from "vitest";
import {
  allPermissionCodes,
  groupPermissionCatalog,
  permissionGroupFullySelected,
  togglePermissionGroup,
} from "@/ui/permission-catalog";

const rows = [
  { code: "core.a", module: "core", name: "A", description: "da" },
  { code: "core.b", module: "core", name: "B", description: null },
  { code: "gaming.x", module: "gaming", name: "X", description: "dx" },
  { code: "pos.y", module: "pos", name: "Y", description: null },
];

describe("permission catalog grouping", () => {
  it("groups every row by the source module column without an allowlist", () => {
    const groups = groupPermissionCatalog(rows);
    expect(groups.map((group) => group.module)).toEqual(["core", "gaming", "pos"]);
    expect(groups.flatMap((group) => group.permissions.map((row) => row.code))).toEqual(
      allPermissionCodes(rows),
    );
    expect(allPermissionCodes(rows)).toEqual(["core.a", "core.b", "gaming.x", "pos.y"]);
  });

  it("selects all, clears all, and toggles a whole group", () => {
    expect(allPermissionCodes(rows)).toHaveLength(4);
    const core = ["core.a", "core.b"];
    const selectedGroup = togglePermissionGroup(new Set(), core);
    expect([...selectedGroup].sort()).toEqual(core);
    expect(permissionGroupFullySelected(selectedGroup, core)).toBe(true);
    const clearedGroup = togglePermissionGroup(selectedGroup, core);
    expect(clearedGroup.size).toBe(0);
    const all = new Set(allPermissionCodes(rows));
    expect(all.size).toBe(4);
    all.clear();
    expect(all.size).toBe(0);
  });
});
