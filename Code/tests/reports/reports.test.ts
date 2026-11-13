import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/core/errors";
import { recordExpense, recordSessionPayment } from "@/modules/finance";
import { createProduct } from "@/modules/catalog";
import { addDrinkToSession } from "@/modules/pos";
import { getBranchDashboardTotals, getPilotOperationsReport, getRecordedPaymentsTotal } from "@/modules/reports";
import { createBranch, PERMISSIONS } from "@/modules/identity";
import { endSession, finalizeSessionBilling, startSession } from "@/modules/gaming";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { insertCompletedUnbilledSession, seedPlayableDevice } from "../helpers/gaming";

const T0 = new Date("2026-01-01T10:00:00.000Z");
function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("pilot operational reports", () => {
  it("sums finalized gaming billed amounts and recorded payments as integer minor units", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "rep-ops",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const endedAt = new Date();
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: new Date(endedAt.getTime() - 90_000),
      endedAt,
      sessionNumber: "41",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
    await recordSessionPayment(
      env.db,
      seeded.context.actor,
      sessionId,
      { amountMinor: "200", paymentMethodCode: "CASH" },
      "rep-pay-01",
    );

    const report = await getPilotOperationsReport(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      from: new Date(endedAt.getTime() - 3_600_000),
      to: new Date(endedAt.getTime() + 3_600_000),
    });
    expect(report.timezoneNote).toBe("Asia/Damascus");
    expect(report.sessionsByDay.some((row) => row.gamingBilledMinor === "200")).toBe(true);
    expect(report.paymentsByMethod.some((row) => row.methodCode === "CASH" && row.paymentsRecordedMinor === "200")).toBe(
      true,
    );
    expect(report.outstandingCharges).toHaveLength(0);
    expect(report.deviceUsage.some((row) => row.deviceId === seeded.device.id && row.gamingBilledMinor === "200")).toBe(
      true,
    );
    expect(report.cashierActivity.some((row) => row.paymentsRecordedMinor === "200")).toBe(true);
    expect(report.sessionsByDay.every((row) => /^\d+$/.test(row.gamingBilledMinor))).toBe(true);
    expect(report.paymentsByMethod.every((row) => /^\d+$/.test(row.paymentsRecordedMinor))).toBe(true);
    await expect(
      getRecordedPaymentsTotal(env.db, seeded.context.actor, { branchId: seeded.branch.id }),
    ).resolves.toBe(200n);

    const product = await createProduct(env.db, seeded.context.actor, {
      name: "Water",
      amountMinor: "500",
      productType: "NON_STOCK",
      trackInventory: false,
    });
    const saleSession = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    const sale = await addDrinkToSession(env.db, seeded.context.actor, saleSession.id, {
      productId: product.id,
      quantity: "1",
    });
    await endSession(env.db, seeded.context.actor, saleSession.id);
    await finalizeSessionBilling(env.db, seeded.context.actor, saleSession.id);
    await recordSessionPayment(
      env.db,
      seeded.context.actor,
      saleSession.id,
      { allocations: [{ chargeId: sale.chargeId, amountMinor: "500" }], paymentMethodCode: "CASH" },
      "rep-dashboard-product-payment",
    );
    await recordExpense(
      env.db,
      seeded.context.actor,
      {
        branchId: seeded.branch.id,
        amountMinor: "100",
        description: "Dashboard fixture",
      },
      "rep-dashboard-expense",
    );
    const unpaidSessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: new Date(endedAt.getTime() + 10_000),
      endedAt: new Date(endedAt.getTime() + 100_000),
      sessionNumber: "44",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, unpaidSessionId);

    const dashboard = await getBranchDashboardTotals(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
    });
    expect(dashboard.finalizedGamingMinor).toBe(200n);
    expect(dashboard.completedProductSalesMinor).toBe(500n);
    expect(dashboard.postedExpensesMinor).toBe(100n);
    expect(dashboard.grossHallProfitMinor).toBe(
      dashboard.finalizedGamingMinor + dashboard.completedProductSalesMinor - dashboard.postedExpensesMinor,
    );
    const paidOnlyReport = await getPilotOperationsReport(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      from: new Date(endedAt.getTime() - 3_600_000),
      to: new Date(endedAt.getTime() + 3_600_000),
    });
    expect(paidOnlyReport.sessionsByDay.reduce((sum, row) => sum + BigInt(row.gamingBilledMinor), 0n)).toBe(200n);
    expect(paidOnlyReport.productSalesByDay.reduce((sum, row) => sum + BigInt(row.salesMinor), 0n)).toBe(500n);
    expect(paidOnlyReport.expensesByDay.reduce((sum, row) => sum + BigInt(row.expensesMinor), 0n)).toBe(100n);

    const cashier = await createStaffMember(env, owner, {
      email: "cash@a.com",
      displayName: "Cashier",
      roleCode: "CASH_ONLY",
      permissions: [PERMISSIONS.financePaymentsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const cashContext = await resolveActor(env, cashier.headers, owner.organizationId);
    await expect(
      getPilotOperationsReport(env.db, cashContext.actor, {
        branchId: seeded.branch.id,
        from: new Date(endedAt.getTime() - 3_600_000),
        to: new Date(endedAt.getTime() + 3_600_000),
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("does not include another organization's billed totals", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "rep-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "rep-iso-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA, { branchCode: "AA", deviceCode: "A1" });
    const seededB = await seedPlayableDevice(env, ownerB, { branchCode: "BB", deviceCode: "B1" });
    const sessionB = await insertCompletedUnbilledSession(env, seededB.context.actor, {
      branchId: seededB.branch.id,
      deviceId: seededB.device.id,
      plan: seededB.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "42",
    });
    await finalizeSessionBilling(env.db, seededB.context.actor, sessionB);
    await recordSessionPayment(
      env.db,
      seededB.context.actor,
      sessionB,
      { amountMinor: "200", paymentMethodCode: "CASH" },
      "rep-iso-b-payment",
    );

    const report = await getPilotOperationsReport(env.db, seededA.context.actor, {
      branchId: seededA.branch.id,
      from: at(0),
      to: at(86_400),
    });
    expect(report.sessionsByDay.reduce((sum, row) => sum + Number(row.sessionCount), 0)).toBe(0);
    expect(report.sessionsByDay.some((row) => row.gamingBilledMinor !== "0")).toBe(false);
    await expect(
      getRecordedPaymentsTotal(env.db, seededA.context.actor, { branchId: seededA.branch.id }),
    ).resolves.toBe(0n);
    await expect(
      getRecordedPaymentsTotal(env.db, seededB.context.actor, { branchId: seededB.branch.id }),
    ).resolves.toBe(200n);
    await expect(
      getBranchDashboardTotals(env.db, seededA.context.actor, { branchId: seededA.branch.id }),
    ).resolves.toMatchObject({ finalizedGamingMinor: 0n, completedProductSalesMinor: 0n, postedExpensesMinor: 0n });
    await expect(
      getBranchDashboardTotals(env.db, seededB.context.actor, { branchId: seededB.branch.id }),
    ).resolves.toMatchObject({ finalizedGamingMinor: 200n, grossHallProfitMinor: 200n });
  });

  it("groups calendar days in the organization timezone rather than UTC", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "rep-tz",
    });
    const seeded = await seedPlayableDevice(env, owner, { branchCode: "TZ", deviceCode: "T1" });
    const startedAt = new Date("2026-01-01T21:30:00.000Z");
    const endedAt = new Date("2026-01-01T21:40:00.000Z");
    await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt,
      endedAt,
      sessionNumber: "43",
    });
    const from = new Date("2026-01-01T20:00:00.000Z");
    const to = new Date("2026-01-02T04:00:00.000Z");
    const riyadh = await getPilotOperationsReport(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      from,
      to,
      timeZone: "Asia/Riyadh",
    });
    expect(riyadh.timezoneNote).toBe("Asia/Riyadh");
    expect(riyadh.sessionsByDay.map((row) => row.day)).toEqual(["2026-01-02"]);
    const utc = await getPilotOperationsReport(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      from,
      to,
      timeZone: "UTC",
    });
    expect(utc.timezoneNote).toBe("UTC");
    expect(utc.sessionsByDay.map((row) => row.day)).toEqual(["2026-01-01"]);
  });

  it("omitted branchId aggregates every accessible branch and excludes other organizations", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "rep-all-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "rep-all-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA, { branchCode: "ZZ", deviceCode: "A1" });
    const emptyA = await createBranch(env.db, seededA.context.actor, { code: "AA", name: "Empty A" });
    const seededB = await seedPlayableDevice(env, ownerB, { branchCode: "BB", deviceCode: "B1" });
    const endedAt = new Date();
    await insertCompletedUnbilledSession(env, seededA.context.actor, {
      branchId: seededA.branch.id,
      deviceId: seededA.device.id,
      plan: seededA.plan,
      startedAt: new Date(endedAt.getTime() - 90_000),
      endedAt,
      sessionNumber: "51",
    });
    await insertCompletedUnbilledSession(env, seededB.context.actor, {
      branchId: seededB.branch.id,
      deviceId: seededB.device.id,
      plan: seededB.plan,
      startedAt: new Date(endedAt.getTime() - 90_000),
      endedAt,
      sessionNumber: "52",
    });
    const actorA = (await resolveActor(env, ownerA.headers, ownerA.organizationId)).actor;
    const from = new Date(endedAt.getTime() - 3_600_000);
    const to = new Date(endedAt.getTime() + 3_600_000);
    const all = await getPilotOperationsReport(env.db, actorA, { from, to });
    expect(all.branchId).toBeNull();
    expect(all.sessionsByDay.reduce((sum, row) => sum + Number(row.sessionCount), 0)).toBe(1);

    const emptyOnly = await getPilotOperationsReport(env.db, actorA, {
      branchId: emptyA.id,
      from,
      to,
    });
    expect(emptyOnly.branchId).toBe(emptyA.id);
    expect(emptyOnly.sessionsByDay.reduce((sum, row) => sum + Number(row.sessionCount), 0)).toBe(0);

    const working = await getPilotOperationsReport(env.db, actorA, {
      branchId: seededA.branch.id,
      from,
      to,
    });
    expect(working.sessionsByDay.reduce((sum, row) => sum + Number(row.sessionCount), 0)).toBe(1);

    const limited = await createStaffMember(env, ownerA, {
      email: "limited@a.com",
      displayName: "Limited",
      roleCode: "REP_LIMITED",
      permissions: [
        PERMISSIONS.gamingSessionsRead,
        PERMISSIONS.financePaymentsRead,
        PERMISSIONS.posOrdersRead,
        PERMISSIONS.financeExpensesRead,
      ],
      branches: [{ branchId: seededA.branch.id, accessMode: "VIEW" }],
    });
    const limitedActor = (await resolveActor(env, limited.headers, ownerA.organizationId)).actor;
    const limitedAll = await getPilotOperationsReport(env.db, limitedActor, { from, to });
    expect(limitedAll.sessionsByDay.reduce((sum, row) => sum + Number(row.sessionCount), 0)).toBe(1);
    await expect(getPilotOperationsReport(env.db, limitedActor, { branchId: emptyA.id, from, to })).rejects.toThrow(
      AuthorizationError,
    );
  });
});
