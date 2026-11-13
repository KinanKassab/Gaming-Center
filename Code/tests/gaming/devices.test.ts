import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  archiveArea,
  archiveDevice,
  archiveDeviceType,
  createArea,
  createDevice,
  createDeviceType,
  getDevice,
  listDevices,
  updateDevice,
} from "@/modules/gaming";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { refreshOwnerActor, seedBranchAreaAndType } from "../helpers/gaming";

describe("gaming devices", () => {
  it("creates, filters, updates, and archives a device", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "dev-crud",
    });
    const { context, branch, deviceType, area } = await seedBranchAreaAndType(env, owner);
    const vip = await createArea(env.db, context.actor, {
      branchId: branch.id,
      code: "VIP",
      name: "VIP",
      sortOrder: 2,
    });
    const created = await createDevice(env.db, context.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      code: "pc07",
      name: "PC 07",
    });
    expect(created.code).toBe("PC07");
    expect(created.operationalStatus).toBe("ENABLED");
    expect(created.archivedAt).toBeNull();

    const byCode = await listDevices(env.db, context.actor, { q: "PC07", branchId: branch.id });
    expect(byCode.map((row) => row.id)).toContain(created.id);
    const byArea = await listDevices(env.db, context.actor, { areaId: area.id });
    expect(byArea.map((row) => row.id)).toContain(created.id);

    const updated = await updateDevice(env.db, context.actor, created.id, {
      areaId: vip.id,
      name: "VIP 07",
      operationalStatus: "MAINTENANCE",
    });
    expect(updated.areaId).toBe(vip.id);
    expect(updated.operationalStatus).toBe("MAINTENANCE");

    const archived = await archiveDevice(env.db, context.actor, created.id);
    expect(archived.archivedAt).toBeTruthy();
    const current = await listDevices(env.db, context.actor);
    expect(current.map((row) => row.id)).not.toContain(created.id);
    const archivedList = await listDevices(env.db, context.actor, { archived: "true" });
    expect(archivedList.map((row) => row.id)).toContain(created.id);
    await expect(updateDevice(env.db, context.actor, created.id, { name: "Nope" })).rejects.toThrow(ConflictError);
  });

  it("rejects invalid branch, area, type, and ownership mutation attempts", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "dev-invalid",
    });
    const { context: seeded, branch, deviceType, area } = await seedBranchAreaAndType(env, owner);
    let context = seeded;
    const otherBranch = await createBranch(env.db, context.actor, { code: "MZH", name: "Mezzeh" });
    context = await refreshOwnerActor(env, owner);
    const otherArea = await createArea(env.db, context.actor, {
      branchId: otherBranch.id,
      code: "HALL",
      name: "Hall",
    });

    await expect(
      createDevice(env.db, context.actor, {
        branchId: branch.id,
        areaId: otherArea.id,
        deviceTypeId: deviceType.id,
        code: "PC01",
        name: "PC 01",
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      createDevice(env.db, context.actor, {
        branchId: branch.id,
        areaId: createId(),
        deviceTypeId: deviceType.id,
        code: "PC01",
        name: "PC 01",
      }),
    ).rejects.toThrow(NotFoundError);

    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "dev-invalid-b",
    });
    const seededB = await seedBranchAreaAndType(env, ownerB, { branchCode: "B1", typeCode: "VR" });
    await expect(
      createDevice(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: seededB.deviceType.id,
        code: "PC01",
        name: "PC 01",
      }),
    ).rejects.toThrow(NotFoundError);

    const archivedType = await createDeviceType(env.db, context.actor, { code: "OLD", name: "Old" });
    await archiveDeviceType(env.db, context.actor, archivedType.id);
    await expect(
      createDevice(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: archivedType.id,
        code: "PC02",
        name: "PC 02",
      }),
    ).rejects.toThrow(ConflictError);

    await archiveArea(env.db, context.actor, area.id);
    await expect(
      createDevice(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        code: "PC03",
        name: "PC 03",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects missing permission, VIEW-only branch access, and cross-tenant UUIDs", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "dev-perm",
    });
    const { context: seeded, branch, deviceType, area } = await seedBranchAreaAndType(env, owner);
    let context = seeded;
    const mezzeh = await createBranch(env.db, context.actor, { code: "MZH", name: "Mezzeh" });
    context = await refreshOwnerActor(env, owner);
    const mezzehArea = await createArea(env.db, context.actor, {
      branchId: mezzeh.id,
      code: "HALL",
      name: "Hall",
    });
    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "DEV_VIEW",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: branch.id, accessMode: "VIEW" }],
    });
    const viewerContext = await resolveActor(env, viewer.headers, owner.organizationId);
    await expect(
      createDevice(env.db, viewerContext.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        code: "PC01",
        name: "PC 01",
      }),
    ).rejects.toThrow(AuthorizationError);

    const manager = await createStaffMember(env, owner, {
      email: "mgr@a.com",
      displayName: "Manager",
      roleCode: "DEV_MGR",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: branch.id, accessMode: "MANAGE" }],
    });
    const managerContext = await resolveActor(env, manager.headers, owner.organizationId);
    const device = await createDevice(env.db, managerContext.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      code: "PC01",
      name: "PC 01",
    });
    await expect(
      createDevice(env.db, managerContext.actor, {
        branchId: mezzeh.id,
        areaId: mezzehArea.id,
        deviceTypeId: deviceType.id,
        code: "PC09",
        name: "PC 09",
      }),
    ).rejects.toThrow(AuthorizationError);

    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "dev-perm-b",
    });
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    await expect(getDevice(env.db, contextB.actor, device.id)).rejects.toThrow(NotFoundError);
  });

  it("does not archive an area that still has current devices", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "dev-area-block",
    });
    const { context, branch, deviceType, area } = await seedBranchAreaAndType(env, owner);
    await createDevice(env.db, context.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      code: "PC01",
      name: "PC 01",
    });
    await expect(archiveArea(env.db, context.actor, area.id)).rejects.toThrow(ConflictError);
  });

  it("audits device mutations including area assignment", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "dev-audit",
    });
    const { context, branch, deviceType, area } = await seedBranchAreaAndType(env, owner);
    const vip = await createArea(env.db, context.actor, { branchId: branch.id, code: "VIP", name: "VIP" });
    const created = await createDevice(env.db, context.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      code: "PC01",
      name: "PC 01",
    });
    await updateDevice(env.db, context.actor, created.id, { areaId: vip.id, deviceTypeId: deviceType.id });
    await archiveDevice(env.db, context.actor, created.id);
    const logs = await listAuditLogs(env.db, context.actor, { limit: 50 });
    expect(logs.map((row) => row.action)).toEqual(
      expect.arrayContaining(["gaming.device.created", "gaming.device.updated", "gaming.device.archived"]),
    );
  });
});
