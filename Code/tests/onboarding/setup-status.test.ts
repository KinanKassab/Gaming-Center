import { describe, expect, it } from "vitest";
import { createPricingAssignment, createPricingPlan, createDevice } from "@/modules/gaming";
import { getGamingCenterSetupStatus } from "@/modules/onboarding/status";
import { shouldAutoOpenGuidedSetup, shouldPresentGuidedSetup } from "@/modules/onboarding/presentation";
import { createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedBranchAreaAndType } from "../helpers/gaming";

describe("gaming center setup status", () => {
  it("derives readiness from actual business rows", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "setup-status",
    });
    const empty = await resolveActor(env, owner.headers, owner.organizationId);
    const before = await getGamingCenterSetupStatus(env.db, empty.actor);
    expect(before.operationallyReady).toBe(false);
    expect(before.steps.find((step) => step.id === "payments")?.done).toBe(true);
    expect(before.steps.find((step) => step.id === "staff")?.optional).toBe(true);

    const seeded = await seedBranchAreaAndType(env, owner);
    const plan = await createPricingPlan(env.db, seeded.context.actor, {
      name: "Hourly",
      pricingModel: "TIME_BASED",
      priceMajor: "10000",
      billingUnitSeconds: 3600,
    });
    const device = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5 - 01",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: device.id,
    });
    const after = await getGamingCenterSetupStatus(env.db, seeded.context.actor);
    expect(after.operationallyReady).toBe(true);
    expect(after.steps.find((step) => step.id === "staff")?.done).toBe(false);
    expect(shouldPresentGuidedSetup({ completed: false })).toBe(true);
    expect(
      shouldPresentGuidedSetup({ completed: false, operationallyReady: after.operationallyReady }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuidedSetup({ completed: false, operationallyReady: after.operationallyReady }),
    ).toBe(false);
  });
});
