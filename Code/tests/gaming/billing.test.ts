import { describe, expect, it } from "vitest";
import { AuthorizationError, BillingError, NotFoundError } from "@/core/errors";
import { sql } from "drizzle-orm";
import { gamingSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { PERMISSIONS } from "@/modules/identity";
import {
  cancelSession,
  createDevice,
  createPricingAssignment,
  createPricingPlan,
  endSession,
  finalizeSessionBilling,
  getSession,
  getSessionBilling,
  moveSession,
  startSession,
  updatePricingPlan,
} from "@/modules/gaming";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { insertCompletedUnbilledSession, seedBranchAreaAndType, seedPlayableDevice } from "../helpers/gaming";

const T0 = new Date("2026-01-01T10:00:00.000Z");
function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("gaming billing", () => {
  it("finalizes billing on end from the captured snapshot, not a later plan edit", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-hist",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    const ended = await endSession(env.db, seeded.context.actor, started.id);
    expect(ended.status).toBe("COMPLETED");
    expect(ended.gamingTotalMinor).toBe("0");

    await updatePricingPlan(env.db, seeded.context.actor, seeded.plan.id, { rateMinor: 99999 });
    const billing = await getSessionBilling(env.db, seeded.context.actor, started.id);
    expect(billing.status).toBe("FINALIZED");
    expect(billing.result?.totalMinor).toBe("0");
    expect(billing.result?.segments[0]?.rateMinor).toBe("100");

    const again = await finalizeSessionBilling(env.db, seeded.context.actor, started.id);
    expect(again.result?.totalMinor).toBe("0");
  });

  it("bills a 90-second TIME_BASED segment from historical facts after a plan change", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-90",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "11",
    });
    await updatePricingPlan(env.db, seeded.context.actor, seeded.plan.id, { rateMinor: 1 });
    const finalized = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.result?.totalMinor).toBe("200");
    expect(finalized.result?.billableSeconds).toBe("90");

    const detail = await getSession(env.db, seeded.context.actor, sessionId);
    expect(detail.session.gamingTotalMinor).toBe("200");
    expect(detail.segments[0]?.computedAmountMinor).toBe("200");
  });

  it("finalizes PRORATED_HOUR from the captured snapshot and does not rewrite it after a plan edit", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-prorated-hist",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const plan = await createPricingPlan(env.db, seeded.context.actor, {
      name: "Hourly",
      pricingModel: "TIME_BASED",
      rateMinor: 100,
      timeBillingMode: "PRORATED_HOUR",
    });
    const device = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS 1",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: device.id,
    });
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: device.id,
      plan,
      startedAt: at(0),
      endedAt: at(300),
      sessionNumber: "31",
    });
    await updatePricingPlan(env.db, seeded.context.actor, plan.id, { rateMinor: 99999 });
    const finalized = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.result?.totalMinor).toBe("10");
    expect(finalized.result?.ruleVersion).toBe("gaming.billing.v2");

    const again = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(again.result?.totalMinor).toBe("10");
  });

  it("charges the PRORATED_HOUR 5-minute minimum once after MOVE, not once per segment", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-prorated-move",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const plan = await createPricingPlan(env.db, seeded.context.actor, {
      name: "Hourly",
      pricingModel: "TIME_BASED",
      rateMinor: 100,
      timeBillingMode: "PRORATED_HOUR",
    });
    const firstDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "Station A",
    });
    const secondDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "Station B",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: firstDevice.id,
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: secondDevice.id,
    });
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: firstDevice.id,
      plan,
      startedAt: at(0),
      endedAt: at(33),
      sessionNumber: "71",
      extraSegments: [
        {
          deviceId: secondDevice.id,
          plan,
          startedAt: at(12),
          endedAt: at(33),
        },
      ],
    });
    const finalized = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.result?.ruleVersion).toBe("gaming.billing.v2");
    expect(finalized.result?.billableSeconds).toBe("33");
    expect(finalized.result?.totalMinor).toBe("10");
    expect(finalized.result?.segments).toHaveLength(2);
    expect(finalized.result?.segments.reduce((sum, line) => sum + Number(line.amountMinor), 0)).toBe(10);

    const again = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(again.result?.totalMinor).toBe("10");

    const detail = await getSession(env.db, seeded.context.actor, sessionId);
    expect(detail.segments).toHaveLength(2);
    expect(detail.segments[0]?.endReason).toBe("MOVE");
    expect(detail.segments.map((row) => row.computedAmountMinor).every((amount) => amount != null)).toBe(true);
    const stored = detail.segments.reduce((sum, row) => sum + Number(row.computedAmountMinor), 0);
    expect(stored).toBe(10);
    expect(detail.session.gamingTotalMinor).toBe("10");
  });

  it("finalizes a same-second live MOVE without writing conflicting per-segment PRORATED amounts", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-prorated-live-move",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const plan = await createPricingPlan(env.db, seeded.context.actor, {
      name: "Hourly",
      pricingModel: "TIME_BASED",
      rateMinor: 100,
      timeBillingMode: "PRORATED_HOUR",
    });
    const firstDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "Live A",
    });
    const secondDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "Live B",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: firstDevice.id,
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: secondDevice.id,
    });
    const started = await startSession(env.db, seeded.context.actor, { deviceId: firstDevice.id });
    await moveSession(env.db, seeded.context.actor, started.id, { deviceId: secondDevice.id });
    const ended = await endSession(env.db, seeded.context.actor, started.id);
    expect(ended.status).toBe("COMPLETED");
    expect(ended.gamingTotalMinor).toBe("0");
    const detail = await getSession(env.db, seeded.context.actor, started.id);
    expect(detail.segments).toHaveLength(2);
    expect(detail.segments[0]?.endReason).toBe("MOVE");
    expect(detail.session.gamingTotalMinor).toBe("0");
    const again = await finalizeSessionBilling(env.db, seeded.context.actor, started.id);
    expect(again.result?.totalMinor).toBe("0");
  });

  it("excludes a stored non-billable pause and includes a billable pause", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-pause",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const excluded = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "21",
      pauses: [{ startedAt: at(10), endedAt: at(40), isBillable: false }],
    });
    const included = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "22",
      pauses: [{ startedAt: at(10), endedAt: at(40), isBillable: true }],
    });
    const skipped = await finalizeSessionBilling(env.db, seeded.context.actor, excluded);
    const kept = await finalizeSessionBilling(env.db, seeded.context.actor, included);
    expect(skipped.result?.totalMinor).toBe("100");
    expect(kept.result?.totalMinor).toBe("200");
  });

  it("bills each moved segment from its own snapshot", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-move",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const otherPlan = await createPricingPlan(env.db, seeded.context.actor, {
      code: "PREM",
      name: "Premium",
      pricingModel: "TIME_BASED",
      rateMinor: 250,
      billingUnitSeconds: 60,
      roundingMode: "CEIL",
    });
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(120),
      sessionNumber: "31",
      extraSegments: [
        {
          deviceId: seeded.device.id,
          plan: otherPlan,
          startedAt: at(60),
          endedAt: at(120),
        },
      ],
    });
    const billed = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(billed.result?.segments).toHaveLength(2);
    expect(billed.result?.segments[0]?.amountMinor).toBe("100");
    expect(billed.result?.segments[1]?.amountMinor).toBe("250");
    expect(billed.result?.totalMinor).toBe("350");
  });

  it("charges PACKAGE within duration and refuses overage", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-pkg",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const pack = await createPricingPlan(env.db, seeded.context.actor, {
      code: "HOUR",
      name: "Hour pack",
      pricingModel: "PACKAGE",
      roundingMode: "CEIL",
      packageDurationSeconds: 3600,
      packagePriceMinor: 5000,
    });
    const ok = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: pack,
      startedAt: at(0),
      endedAt: at(600),
      sessionNumber: "41",
    });
    const over = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: pack,
      startedAt: at(0),
      endedAt: at(3601),
      sessionNumber: "42",
    });
    const billed = await finalizeSessionBilling(env.db, seeded.context.actor, ok);
    expect(billed.result?.totalMinor).toBe("5000");
    await expect(finalizeSessionBilling(env.db, seeded.context.actor, over)).rejects.toThrow(BillingError);
  });

  it("does not bill CANCELLED sessions", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-cancel",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    await cancelSession(env.db, seeded.context.actor, started.id, { reason: "walked out" });
    const view = await getSessionBilling(env.db, seeded.context.actor, started.id);
    expect(view.status).toBe("NOT_ELIGIBLE");
    expect(view.reason).toBe("CANCELLED_SESSION");
    await expect(finalizeSessionBilling(env.db, seeded.context.actor, started.id)).rejects.toThrow(
      /cancelled/i,
    );
  });

  it("bills FIXED sessions from actual elapsed time, not requested_end_at", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-fixed",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "51",
      sessionType: "FIXED",
      requestedEndAt: at(3600),
    });
    const billed = await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    expect(billed.result?.billableSeconds).toBe("90");
    expect(billed.result?.totalMinor).toBe("200");
  });

  it("rejects finalize for ACTIVE sessions and missing branch operate", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-auth",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    const preview = await getSessionBilling(env.db, seeded.context.actor, started.id);
    expect(preview.status).toBe("PROVISIONAL");
    await expect(finalizeSessionBilling(env.db, seeded.context.actor, started.id)).rejects.toThrow(
      BillingError,
    );

    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "VIEWONLY",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const viewContext = await resolveActor(env, viewer.headers, owner.organizationId);
    await endSession(env.db, seeded.context.actor, started.id);
    await expect(finalizeSessionBilling(env.db, viewContext.actor, started.id)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("does not disclose a cross-tenant session id", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "bill-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA);
    const seededB = await seedPlayableDevice(env, ownerB, { branchCode: "MZB" });
    const started = await startSession(env.db, seededA.context.actor, { deviceId: seededA.device.id });
    await expect(getSessionBilling(env.db, seededB.context.actor, started.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(finalizeSessionBilling(env.db, seededB.context.actor, started.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses to overwrite a finalized total", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bill-immut",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "61",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    await expect(
      withTenant(env.db, { organizationId: owner.organizationId, userId: seeded.context.actor.userId }, async (tx) => {
        await tx
          .update(gamingSessions)
          .set({ gamingTotalMinor: 1n })
          .where(sql`id = ${sessionId}`);
      }),
    ).rejects.toThrow();
  });
});
