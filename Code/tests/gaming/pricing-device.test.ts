import { describe, expect, it } from "vitest";
import { AuthorizationError, NotFoundError, ValidationError } from "@/core/errors";
import { withTenant } from "@/db/tenant";
import { createDevice, createDevicePricing, listPricingAssignments, summarizeDeviceScopedPrices } from "@/modules/gaming";
import { resolveDevicePricing } from "@/modules/gaming/pricing-resolve";
import { PERMISSIONS } from "@/modules/identity";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedBranchAreaAndType } from "../helpers/gaming";

describe("device-scoped pricing", () => {
  it("summarizes hourly rows and groups offer devices", () => {
    const summary = summarizeDeviceScopedPrices({
      plans: [
        {
          id: "plan-h",
          name: "PS5-1",
          status: "ACTIVE",
          pricingModel: "TIME_BASED",
          currency: "SYP",
          rateMinor: "10000",
          billingUnitSeconds: 3600,
          roundingMode: "NEAREST",
          timeBillingMode: "PRORATED_HOUR",
          packagePriceMinor: null,
          packageDurationSeconds: null,
        },
        {
          id: "plan-o",
          name: "3 hours",
          status: "ACTIVE",
          pricingModel: "PACKAGE",
          currency: "SYP",
          rateMinor: null,
          billingUnitSeconds: null,
          roundingMode: "CEIL",
          timeBillingMode: "UNIT",
          packagePriceMinor: "25000",
          packageDurationSeconds: 10800,
        },
      ],
      assignments: [
        { pricingPlanId: "plan-h", scopeType: "DEVICE", scopeId: "d1", status: "ACTIVE" },
        { pricingPlanId: "plan-o", scopeType: "DEVICE", scopeId: "d1", status: "ACTIVE" },
        { pricingPlanId: "plan-o", scopeType: "DEVICE", scopeId: "d2", status: "ACTIVE" },
        { pricingPlanId: "plan-h", scopeType: "ORGANIZATION", scopeId: "org", status: "ACTIVE" },
      ],
      devices: [
        { id: "d1", name: "PS5-1" },
        { id: "d2", name: "PS5-2" },
      ],
    });
    expect(summary.hourly).toEqual([
      expect.objectContaining({
        scopeType: "DEVICE",
        deviceId: "d1",
        deviceName: "PS5-1",
        planId: "plan-h",
      }),
    ]);
    expect(summary.offers).toEqual([
      expect.objectContaining({
        planId: "plan-o",
        name: "3 hours",
        deviceIds: ["d1", "d2"],
        deviceNames: ["PS5-1", "PS5-2"],
      }),
    ]);
  });

  it("summarizes hourly and offer rows scoped to a device type", () => {
    const summary = summarizeDeviceScopedPrices({
      plans: [
        {
          id: "plan-h",
          name: "PC station",
          status: "ACTIVE",
          pricingModel: "TIME_BASED",
          currency: "SYP",
          rateMinor: "10000",
          billingUnitSeconds: 3600,
          roundingMode: "NEAREST",
          timeBillingMode: "PRORATED_HOUR",
          packagePriceMinor: null,
          packageDurationSeconds: null,
        },
        {
          id: "plan-o",
          name: "3 hours",
          status: "ACTIVE",
          pricingModel: "PACKAGE",
          currency: "SYP",
          rateMinor: null,
          billingUnitSeconds: null,
          roundingMode: "CEIL",
          timeBillingMode: "UNIT",
          packagePriceMinor: "25000",
          packageDurationSeconds: 10800,
        },
      ],
      assignments: [
        { pricingPlanId: "plan-h", scopeType: "DEVICE_TYPE", scopeId: "t1", status: "ACTIVE" },
        { pricingPlanId: "plan-o", scopeType: "DEVICE_TYPE", scopeId: "t1", status: "ACTIVE" },
        { pricingPlanId: "plan-h", scopeType: "ORGANIZATION", scopeId: "org", status: "ACTIVE" },
      ],
      devices: [{ id: "d1", name: "PC-1" }],
      deviceTypes: [{ id: "t1", name: "PC station" }],
    });
    expect(summary.hourly).toEqual([
      expect.objectContaining({
        scopeType: "DEVICE_TYPE",
        deviceId: "t1",
        deviceName: "PC station",
        planId: "plan-h",
      }),
    ]);
    expect(summary.offers).toEqual([
      expect.objectContaining({
        planId: "plan-o",
        name: "3 hours",
        deviceIds: ["t1"],
        deviceNames: ["PC station"],
      }),
    ]);
  });

  it("creates an hourly price named from the device and assigns it to that device", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "device-price-hourly",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const device = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5-1",
    });
    const created = await createDevicePricing(env.db, seeded.context.actor, {
      kind: "HOURLY",
      deviceIds: [device.id],
      priceMajor: "10000",
    });
    expect(created.plan.name).toBe("PS5-1");
    expect(created.plan.pricingModel).toBe("TIME_BASED");
    expect(created.plan.timeBillingMode).toBe("PRORATED_HOUR");
    expect(created.plan.rateMinor).toBe(10000n);
    expect(created.plan.billingUnitSeconds).toBe(3600);
    expect(created.assignments).toHaveLength(1);
    expect(created.assignments[0]?.scopeType).toBe("DEVICE");
    expect(created.assignments[0]?.scopeId).toBe(device.id);
    expect(created.assignments[0]?.branchId).toBe(seeded.branch.id);

    await expect(
      createDevicePricing(env.db, seeded.context.actor, {
        kind: "HOURLY",
        deviceIds: [device.id],
        priceMajor: "12000",
      }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "device_hourly_exists" });
  });

  it("rejects a zero hourly price", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "device-price-zero",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const device = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5-0",
    });
    await expect(
      createDevicePricing(env.db, seeded.context.actor, {
        kind: "HOURLY",
        deviceIds: [device.id],
        priceMajor: "0",
      }),
    ).rejects.toMatchObject({ name: "ValidationError", reason: "hourly_price_not_positive" });
  });

  it("creates an hourly price named from the device type and applies it to every station of that type", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "device-type-price-hourly",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const first = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PC-1",
    });
    const second = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PC-2",
    });
    const created = await createDevicePricing(env.db, seeded.context.actor, {
      kind: "HOURLY",
      deviceTypeIds: [seeded.deviceType.id],
      priceMajor: "10000",
    });
    expect(created.plan.name).toBe("PC station");
    expect(created.plan.pricingModel).toBe("TIME_BASED");
    expect(created.assignments).toHaveLength(1);
    expect(created.assignments[0]?.scopeType).toBe("DEVICE_TYPE");
    expect(created.assignments[0]?.scopeId).toBe(seeded.deviceType.id);
    expect(created.assignments[0]?.branchId).toBeNull();

    const resolvedFirst = await withTenant(
      env.db,
      { organizationId: owner.organizationId, userId: seeded.context.actor.userId },
      (tx) => resolveDevicePricing(tx, first, new Date()),
    );
    const resolvedSecond = await withTenant(
      env.db,
      { organizationId: owner.organizationId, userId: seeded.context.actor.userId },
      (tx) => resolveDevicePricing(tx, second, new Date()),
    );
    expect(resolvedFirst.pricingPlanId).toBe(created.plan.id);
    expect(resolvedSecond.pricingPlanId).toBe(created.plan.id);

    await expect(
      createDevicePricing(env.db, seeded.context.actor, {
        kind: "HOURLY",
        deviceTypeIds: [seeded.deviceType.id],
        priceMajor: "12000",
      }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "device_type_hourly_exists" });
  });

  it("creates a named offer on multiple devices without replacing hourly resolution", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "device-price-offer",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const first = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5-1",
    });
    const second = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5-2",
    });
    const hourly = await createDevicePricing(env.db, seeded.context.actor, {
      kind: "HOURLY",
      deviceIds: [first.id],
      priceMajor: "10000",
    });
    const offer = await createDevicePricing(env.db, seeded.context.actor, {
      kind: "OFFER",
      deviceIds: [first.id, second.id],
      name: "3 hours PS5",
      priceMajor: "25000",
      durationSeconds: 10800,
    });
    expect(offer.plan.pricingModel).toBe("PACKAGE");
    expect(offer.plan.name).toBe("3 hours PS5");
    expect(offer.plan.packagePriceMinor).toBe(25000n);
    expect(offer.plan.packageDurationSeconds).toBe(10800);
    expect(offer.assignments.map((row) => row.scopeId).sort()).toEqual([first.id, second.id].sort());
    expect(offer.assignments.every((row) => row.priority < 0)).toBe(true);

    const assigned = await listPricingAssignments(env.db, seeded.context.actor);
    expect(assigned).toHaveLength(3);

    const resolved = await withTenant(
      env.db,
      { organizationId: owner.organizationId, userId: seeded.context.actor.userId },
      (tx) => resolveDevicePricing(tx, first, new Date()),
    );
    expect(resolved.pricingPlanId).toBe(hourly.plan.id);
    expect(resolved.snapshot.pricingModel).toBe("TIME_BASED");
  });

  it("rejects missing devices, extra hourly devices, and other-tenant device ids", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "device-price-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "device-price-iso-b",
    });
    const seededA = await seedBranchAreaAndType(env, ownerA);
    const deviceA = await createDevice(env.db, seededA.context.actor, {
      branchId: seededA.branch.id,
      areaId: seededA.area.id,
      deviceTypeId: seededA.deviceType.id,
      name: "A-1",
    });
    const seededB = await seedBranchAreaAndType(env, ownerB);
    const deviceB = await createDevice(env.db, seededB.context.actor, {
      branchId: seededB.branch.id,
      areaId: seededB.area.id,
      deviceTypeId: seededB.deviceType.id,
      name: "B-1",
    });
    const extra = await createDevice(env.db, seededA.context.actor, {
      branchId: seededA.branch.id,
      areaId: seededA.area.id,
      deviceTypeId: seededA.deviceType.id,
      name: "A-2",
    });

    await expect(
      createDevicePricing(env.db, seededA.context.actor, {
        kind: "HOURLY",
        deviceIds: [deviceA.id, extra.id],
        priceMajor: "10000",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      createDevicePricing(env.db, seededA.context.actor, {
        kind: "OFFER",
        deviceIds: [deviceA.id],
        priceMajor: "25000",
        durationSeconds: 3600,
      }),
    ).rejects.toMatchObject({ name: "ValidationError", reason: "offer_needs_name" });

    await expect(
      createDevicePricing(env.db, seededA.context.actor, {
        kind: "HOURLY",
        deviceIds: [deviceB.id],
        priceMajor: "10000",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const reader = await createStaffMember(env, ownerA, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "PRICE_READ",
      permissions: [PERMISSIONS.gamingMasterRead],
    });
    const readerContext = await resolveActor(env, reader.headers, ownerA.organizationId);
    await expect(
      createDevicePricing(env.db, readerContext.actor, {
        kind: "HOURLY",
        deviceIds: [deviceA.id],
        priceMajor: "10000",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
