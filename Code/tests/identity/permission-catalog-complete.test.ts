import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERMISSIONS, listPermissionCatalog } from "@/modules/identity";
import { groupPermissionCatalog } from "@/ui/permission-catalog";
import { createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("permission catalog completeness", () => {
  it("RolePermissionsEditor displays every core_permissions row from listPermissionCatalog", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@catalog.com",
      name: "Owner Catalog",
      slug: "perm-cat",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const catalog = await listPermissionCatalog(env.db, context.actor);
    const dbCodes = catalog.map((row) => row.code).sort();
    const typedCodes = Object.values(PERMISSIONS).slice().sort();
    expect(dbCodes).toEqual(typedCodes);
    expect(groupPermissionCatalog(catalog).flatMap((group) => group.permissions.map((row) => row.code)).sort()).toEqual(
      dbCodes,
    );

    const editor = source("app/admin/_components/controls.tsx");
    expect(editor).toContain("groupPermissionCatalog");
    expect(editor).toContain("roles.selectAll");
    expect(editor).toContain("roles.deselectAll");
    expect(editor).toContain("roles.selectGroup");
    expect(editor).toContain("permissionDescriptionText");
    expect(editor).not.toContain('module === "core"');
    expect(source("app/admin/roles/page.tsx")).toContain("description: row.description");
  });
});
