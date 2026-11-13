import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  archivePricingPlan,
  createPricingAssignment,
  createPricingPlan,
  getPricingPlan,
  listPricingAssignments,
  listPricingPlans,
  updatePricingAssignment,
  updatePricingPlan,
} from "@/modules/gaming";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { refreshOwnerActor, seedBranchAreaAndType } from "../helpers/gaming";

describe("gaming pricing plans", () => {
  it("creates time-based and package plans and archives them", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-crud",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const time = await createPricingPlan(env.db, context.actor, {
      code: "standard_pc",
      name: "Standard PC",
      pricingModel: "TIME_BASED",
      rateMinor: "1500",
      billingUnitSeconds: 60,
      roundingMode: "CEIL",
    });
    expect(time.code).toBe("STANDARD_PC");
    expect(time.currency).toBe("SYP");
    expect(time.rateMinor).toBe(1500n);

    const pack = await createPricingPlan(env.db, context.actor, {
      code: "HOUR_PC",
      name: "One hour",
      pricingModel: "PACKAGE",
      packageDurationSeconds: 3600,
      packagePriceMinor: 50000,
      roundingMode: "NEAREST",
    });
    expect(pack.packagePriceMinor).toBe(50000n);

    const listed = await listPricingPlans(env.db, context.actor, { q: "PC" });
    expect(listed.map((row) => row.id).sort()).toEqual([time.id, pack.id].sort());

    const updated = await updatePricingPlan(env.db, context.actor, time.id, { rateMinor: 2000 });
    expect(updated.rateMinor).toBe(2000n);
    await archivePricingPlan(env.db, context.actor, time.id);
    await expect(updatePricingPlan(env.db, context.actor, time.id, { name: "Nope" })).rejects.toThrow(ConflictError);
  });

  it("maps friendly price and duration to existing TIME_BASED semantics without changing math", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-friendly",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const plan = await createPricingPlan(env.db, context.actor, {
      name: "PlayStation 5",
      pricingModel: "TIME_BASED",
      priceMajor: "10000",
      billingUnitSeconds: 3600,
      partialPeriod: "started",
    });
    expect(plan.code.startsWith("P-")).toBe(true);
    expect(plan.rateMinor).toBe(10000n);
    expect(plan.billingUnitSeconds).toBe(3600);
    expect(plan.roundingMode).toBe("CEIL");
    expect(plan.minimumBillableSeconds).toBe(0);
    expect(plan.minimumChargeMinor).toBe(0n);
    expect(plan.currency).toBe("SYP");
    expect(plan.timeBillingMode).toBe("UNIT");
  });

  it("defaults owner-created hourly plans to PRORATED_HOUR", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-prorated-default",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const plan = await createPricingPlan(env.db, context.actor, {
      name: "PlayStation 5",
      pricingModel: "TIME_BASED",
      priceMajor: "10000",
    });
    expect(plan.timeBillingMode).toBe("PRORATED_HOUR");
    expect(plan.rateMinor).toBe(10000n);
    expect(plan.billingUnitSeconds).toBe(3600);
    expect(plan.roundingMode).toBe("NEAREST");
  });

  it("rejects invalid plan shapes and missing permission", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-invalid",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await expect(
      createPricingPlan(env.db, context.actor, {
        code: "BAD",
        name: "Bad",
        pricingModel: "TIME_BASED",
        roundingMode: "CEIL",
      }),
    ).rejects.toThrow(ValidationError);

    const staff = await createStaffMember(env, owner, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "PRICE_READ",
      permissions: [PERMISSIONS.gamingMasterRead],
    });
    const staffContext = await resolveActor(env, staff.headers, owner.organizationId);
    await expect(
      createPricingPlan(env.db, staffContext.actor, {
        code: "PC",
        name: "PC",
        pricingModel: "TIME_BASED",
        rateMinor: 1,
        billingUnitSeconds: 60,
        roundingMode: "FLOOR",
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("assigns plans to organization, branch, and area scopes with branch access", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-assign",
    });
    const { context: seeded, branch, area } = await seedBranchAreaAndType(env, owner);
    let context = seeded;
    const other = await createBranch(env.db, context.actor, { code: "MZH", name: "Mezzeh" });
    context = await refreshOwnerActor(env, owner);
    const plan = await createPricingPlan(env.db, context.actor, {
      code: "STD",
      name: "Standard",
      pricingModel: "TIME_BASED",
      rateMinor: 100,
      billingUnitSeconds: 60,
      roundingMode: "CEIL",
    });
    const orgAssignment = await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: plan.id,
      scopeType: "ORGANIZATION",
    });
    expect(orgAssignment.scopeId).toBe(owner.organizationId);
    expect(orgAssignment.branchId).toBeNull();

    const areaAssignment = await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: plan.id,
      scopeType: "AREA",
      branchId: branch.id,
      scopeId: area.id,
      priority: 10,
    });
    expect(areaAssignment.scopeId).toBe(area.id);

    await expect(
      createPricingAssignment(env.db, context.actor, {
        pricingPlanId: plan.id,
        scopeType: "AREA",
        branchId: other.id,
        scopeId: area.id,
      }),
    ).rejects.toThrow(ValidationError);

    const manager = await createStaffMember(env, owner, {
      email: "mgr@a.com",
      displayName: "Manager",
      roleCode: "PRICE_MGR",
      permissions: [PERMISSIONS.gamingMasterRead, PERMISSIONS.gamingMasterManage],
      branches: [{ branchId: branch.id, accessMode: "MANAGE" }],
    });
    const managerContext = await resolveActor(env, manager.headers, owner.organizationId);
    await expect(
      createPricingAssignment(env.db, managerContext.actor, {
        pricingPlanId: plan.id,
        scopeType: "BRANCH",
        branchId: other.id,
      }),
    ).rejects.toThrow(AuthorizationError);

    const deactivated = await updatePricingAssignment(env.db, context.actor, areaAssignment.id, {
      status: "INACTIVE",
    });
    expect(deactivated.status).toBe("INACTIVE");
    const active = await listPricingAssignments(env.db, context.actor);
    expect(active.map((row) => row.id)).toContain(orgAssignment.id);
    expect(active.map((row) => row.id)).not.toContain(areaAssignment.id);
  });

  it("hides other tenants' plans and audits mutations", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "price-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "price-iso-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    const planB = await createPricingPlan(env.db, contextB.actor, {
      code: "B",
      name: "B",
      pricingModel: "PACKAGE",
      packageDurationSeconds: 1800,
      packagePriceMinor: "1",
      roundingMode: "FLOOR",
    });
    await expect(getPricingPlan(env.db, contextA.actor, planB.id)).rejects.toThrow(NotFoundError);

    const planA = await createPricingPlan(env.db, contextA.actor, {
      code: "A",
      name: "A",
      pricingModel: "TIME_BASED",
      rateMinor: 1,
      billingUnitSeconds: 60,
      roundingMode: "CEIL",
    });
    await updatePricingPlan(env.db, contextA.actor, planA.id, { name: "Alpha" });
    await archivePricingPlan(env.db, contextA.actor, planA.id);
    const logs = await listAuditLogs(env.db, contextA.actor, { limit: 50 });
    expect(logs.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "gaming.pricing_plan.created",
        "gaming.pricing_plan.updated",
        "gaming.pricing_plan.archived",
      ]),
    );
  });
});
