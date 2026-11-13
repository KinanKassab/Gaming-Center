import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import { archiveArea, createArea, getArea, listAreas, updateArea } from "@/modules/gaming";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { refreshOwnerActor } from "../helpers/gaming";

describe("gaming areas", () => {
  it("creates, lists, updates, and archives an area", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "area-crud",
    });
    let context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { code: "JRM", name: "Jaramana" });
    context = await refreshOwnerActor(env, owner);
    const created = await createArea(env.db, context.actor, {
      branchId: branch.id,
      code: "main",
      name: " Main Hall ",
      sortOrder: 2,
    });
    expect(created.code).toBe("MAIN");
    expect(created.name).toBe("Main Hall");
    expect(created.organizationId).toBe(owner.organizationId);
    expect(created.branchId).toBe(branch.id);

    const autoCoded = await createArea(env.db, context.actor, {
      branchId: branch.id,
      name: "VIP",
    });
    expect(autoCoded.code.startsWith("A-")).toBe(true);

    const listed = await listAreas(env.db, context.actor, { branchId: branch.id });
    expect(listed.map((row) => row.id)).toContain(created.id);

    const unnamedBranch = await createBranch(env.db, context.actor, { name: "Mezzeh" });
    expect(unnamedBranch.code.startsWith("B-")).toBe(true);

    const updated = await updateArea(env.db, context.actor, created.id, { name: "Hall", sortOrder: 1 });
    expect(updated.name).toBe("Hall");
    expect(updated.sortOrder).toBe(1);

    const archived = await archiveArea(env.db, context.actor, created.id);
    expect(archived.status).toBe("ARCHIVED");
    const active = await listAreas(env.db, context.actor);
    expect(active.map((row) => row.id)).not.toContain(created.id);
    const archivedList = await listAreas(env.db, context.actor, { status: "ARCHIVED" });
    expect(archivedList.map((row) => row.id)).toContain(created.id);
    await expect(updateArea(env.db, context.actor, created.id, { name: "Nope" })).rejects.toThrow(ConflictError);
  });

  it("rejects invalid input and duplicate codes in the same branch", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "area-invalid",
    });
    let context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { code: "JRM", name: "Jaramana" });
    context = await refreshOwnerActor(env, owner);
    await expect(
      createArea(env.db, context.actor, { branchId: branch.id, code: "??", name: "Bad" }),
    ).rejects.toThrow(ValidationError);
    await createArea(env.db, context.actor, { branchId: branch.id, code: "VIP", name: "VIP" });
    await expect(
      createArea(env.db, context.actor, { branchId: branch.id, code: "VIP", name: "Other" }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects missing permission and missing branch access", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "area-perm",
    });
    let ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const jaramana = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const mezzeh = await createBranch(env.db, ownerContext.actor, { code: "MZH", name: "Mezzeh" });
    ownerContext = await refreshOwnerActor(env, owner);
    const reader = await createStaffMember(env, owner, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "AREA_READ",
      permissions: [PERMISSIONS.gamingMasterRead],
      branches: [{ branchId: jaramana.id, accessMode: "VIEW" }],
    });
    const readerContext = await resolveActor(env, reader.headers, owner.organizationId);
    await expect(
      createArea(env.db, readerContext.actor, { branchId: jaramana.id, code: "MAIN", name: "Main" }),
    ).rejects.toThrow(AuthorizationError);

    const operator = await createStaffMember(env, owner, {
      email: "op@a.com",
      displayName: "Operator",
      roleCode: "AREA_OP",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: jaramana.id, accessMode: "OPERATE" }],
    });
    const operatorContext = await resolveActor(env, operator.headers, owner.organizationId);
    await expect(
      createArea(env.db, operatorContext.actor, { branchId: jaramana.id, code: "MAIN", name: "Main" }),
    ).rejects.toThrow(AuthorizationError);

    const manager = await createStaffMember(env, owner, {
      email: "mgr@a.com",
      displayName: "Manager",
      roleCode: "AREA_MGR",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: jaramana.id, accessMode: "MANAGE" }],
    });
    const managerContext = await resolveActor(env, manager.headers, owner.organizationId);
    const created = await createArea(env.db, managerContext.actor, {
      branchId: jaramana.id,
      code: "MAIN",
      name: "Main",
    });
    expect(created.id).toBeTruthy();
    await expect(
      createArea(env.db, managerContext.actor, { branchId: mezzeh.id, code: "VIP", name: "VIP" }),
    ).rejects.toThrow(AuthorizationError);
    await expect(getArea(env.db, managerContext.actor, created.id)).resolves.toMatchObject({ code: "MAIN" });
    const hidden = await createArea(env.db, ownerContext.actor, {
      branchId: mezzeh.id,
      code: "OTHER",
      name: "Other",
    });
    await expect(getArea(env.db, managerContext.actor, hidden.id)).rejects.toThrow(AuthorizationError);
    const listed = await listAreas(env.db, managerContext.actor);
    expect(listed.map((row) => row.id)).toEqual([created.id]);
  });

  it("rejects a cross-tenant area UUID as not found", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "area-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "area-iso-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    let contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    const branchB = await createBranch(env.db, contextB.actor, { code: "B1", name: "Branch B" });
    contextB = await refreshOwnerActor(env, ownerB);
    const areaB = await createArea(env.db, contextB.actor, {
      branchId: branchB.id,
      code: "MAIN",
      name: "Main",
    });
    await expect(getArea(env.db, contextA.actor, areaB.id)).rejects.toThrow(NotFoundError);
  });

  it("audits area mutations", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "area-audit",
    });
    let context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { code: "JRM", name: "Jaramana" });
    context = await refreshOwnerActor(env, owner);
    const created = await createArea(env.db, context.actor, {
      branchId: branch.id,
      code: "MAIN",
      name: "Main",
    });
    await updateArea(env.db, context.actor, created.id, { name: "Hall" });
    await archiveArea(env.db, context.actor, created.id);
    const logs = await listAuditLogs(env.db, context.actor, { limit: 50 });
    expect(logs.map((row) => row.action)).toEqual(
      expect.arrayContaining(["gaming.area.created", "gaming.area.updated", "gaming.area.archived"]),
    );
  });
});
