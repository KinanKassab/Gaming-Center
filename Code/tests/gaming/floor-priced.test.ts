import { describe, expect, it } from "vitest";
import {
  createDevice,
  createPricingAssignment,
  createPricingPlan,
  listFloor,
  listPricingAssignments,
  startSession,
  updatePricingAssignment,
} from "@/modules/gaming";
import { createTestEnvironment, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

describe("floor priced devices", () => {
  it("hides unpriced stations and keeps occupied stations even without a current price", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "floor-price",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const extra = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-X",
      name: "No price",
    });

    const before = await listFloor(env.db, seeded.context.actor, { branchId: seeded.branch.id });
    expect(before.map((tile) => tile.deviceId)).toEqual([seeded.device.id]);
    expect(before.some((tile) => tile.deviceId === extra.id)).toBe(false);

    const started = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    const listed = await listPricingAssignments(env.db, seeded.context.actor);
    const deviceAssignment = listed.find((row) => row.scopeId === seeded.device.id);
    expect(deviceAssignment).toBeTruthy();
    await updatePricingAssignment(env.db, seeded.context.actor, deviceAssignment!.id, { status: "INACTIVE" });

    const occupied = await listFloor(env.db, seeded.context.actor, { branchId: seeded.branch.id });
    expect(occupied.some((tile) => tile.deviceId === seeded.device.id && tile.occupancy === "OCCUPIED")).toBe(true);
    expect(occupied.some((tile) => tile.deviceId === extra.id)).toBe(false);
    expect(occupied[0]?.session?.session.id).toBe(started.id);
  });

  it("keeps a station off the hall when the hourly rate is zero or only an offer exists", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "floor-zero-price",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const zero = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-0",
      name: "Zero price",
    });
    const offerOnly = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-P",
      name: "Offer only",
    });
    const zeroPlan = await createPricingPlan(env.db, seeded.context.actor, {
      code: "ZERO",
      name: "Zero hour",
      pricingModel: "TIME_BASED",
      rateMinor: 0,
      billingUnitSeconds: 3600,
      roundingMode: "NEAREST",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: zeroPlan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: zero.id,
    });
    const offer = await createPricingPlan(env.db, seeded.context.actor, {
      code: "PKG",
      name: "3 hours",
      pricingModel: "PACKAGE",
      packagePriceMinor: 25000,
      roundingMode: "CEIL",
      packageDurationSeconds: 10800,
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: offer.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: offerOnly.id,
    });

    const floor = await listFloor(env.db, seeded.context.actor, { branchId: seeded.branch.id });
    const ids = floor.map((tile) => tile.deviceId);
    expect(ids).toContain(seeded.device.id);
    expect(ids).not.toContain(zero.id);
    expect(ids).not.toContain(offerOnly.id);
    expect(floor.find((tile) => tile.deviceId === seeded.device.id)?.hourlyRateMinor).not.toBe("0");
  });
});
