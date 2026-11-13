import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  archiveArea,
  archiveDeviceType,
  createDevicesBulk,
  createDevice,
  previewBulkDeviceNames,
} from "@/modules/gaming";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedBranchAreaAndType } from "../helpers/gaming";

describe("bulk device creation", () => {
  it("creates 10 uniquely coded devices in one transaction", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bulk-ok",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    const created = await createDevicesBulk(env.db, context.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      count: 10,
    });
    expect(created).toHaveLength(10);
    expect(new Set(created.map((row) => row.code)).size).toBe(10);
    expect(created.map((row) => row.name)).toEqual(previewBulkDeviceNames({ deviceTypeName: deviceType.name, count: 10 }));
    expect(created.every((row) => row.operationalStatus === "ENABLED")).toBe(true);
    const audit = await listAuditLogs(env.db, context.actor, { limit: 20 });
    expect(audit.some((row) => row.action === "gaming.device.bulk_created")).toBe(true);
    expect(audit.filter((row) => row.action === "gaming.device.created")).toHaveLength(10);
  });

  it("rejects invalid counts", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bulk-count",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    expect(() => previewBulkDeviceNames({ deviceTypeName: "PS5", count: 0 })).toThrow(ValidationError);
    await expect(
      createDevicesBulk(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        count: 51,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects archived area and device type", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bulk-arch",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    await archiveArea(env.db, context.actor, area.id);
    await expect(
      createDevicesBulk(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        count: 2,
      }),
    ).rejects.toThrow(ConflictError);

    const seeded = await seedBranchAreaAndType(env, owner, { branchCode: "B2", areaCode: "A2", typeCode: "T2" });
    await archiveDeviceType(env.db, seeded.context.actor, seeded.deviceType.id);
    await expect(
      createDevicesBulk(env.db, seeded.context.actor, {
        branchId: seeded.branch.id,
        areaId: seeded.area.id,
        deviceTypeId: seeded.deviceType.id,
        count: 2,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects missing branch permission and foreign-tenant ids", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bulk-perm",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "BULK_VIEW",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: branch.id, accessMode: "VIEW" }],
    });
    const viewerContext = await resolveActor(env, viewer.headers, owner.organizationId);
    await expect(
      createDevicesBulk(env.db, viewerContext.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        count: 2,
      }),
    ).rejects.toThrow(AuthorizationError);

    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "bulk-perm-b",
    });
    const seededB = await seedBranchAreaAndType(env, ownerB, { branchCode: "XB" });
    await expect(
      createDevicesBulk(env.db, context.actor, {
        branchId: branch.id,
        areaId: seededB.area.id,
        deviceTypeId: deviceType.id,
        count: 2,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("serializes concurrent batches without duplicate codes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bulk-race",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    const [first, second] = await Promise.all([
      createDevicesBulk(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        count: 5,
      }),
      createDevicesBulk(env.db, context.actor, {
        branchId: branch.id,
        areaId: area.id,
        deviceTypeId: deviceType.id,
        count: 5,
      }),
    ]);
    const codes = [...first, ...second].map((row) => row.code);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("omitted single-device code is allocated server-side", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "auto-code",
    });
    const { context, branch, area, deviceType } = await seedBranchAreaAndType(env, owner);
    const created = await createDevice(env.db, context.actor, {
      branchId: branch.id,
      areaId: area.id,
      deviceTypeId: deviceType.id,
      name: "Lounge 1",
    });
    expect(created.code.startsWith("D-")).toBe(true);
  });
});
