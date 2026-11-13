import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ValidationError } from "@/core/errors";
import { requireIanaTimeZone } from "@/core/time";
import { assertPermission } from "@/core/tenancy";
import {
  coreOrganizations,
  coreUsers,
  financeCharges,
  financeExpenses,
  financePaymentAllocations,
  financePaymentMethods,
  financePayments,
  gamingDevices,
  gamingSessionSegments,
  gamingSessions,
  posOrders,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { grantedBranchIds, requireBranchAccess } from "@/modules/gaming/access";
import { uuidPattern } from "@/modules/gaming/normalize";
import { toCsv } from "./csv";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export const pilotReportInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id").optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type PilotReportInput = z.infer<typeof pilotReportInputSchema>;

export type DayCountMoney = {
  day: string;
  count: string;
  amountMinor: string;
};

export type SessionsByDay = {
  day: string;
  sessionCount: string;
  completedCount: string;
  billedSessionCount: string;
  gamingBilledMinor: string;
};

export type ProductSalesByDay = {
  day: string;
  orderCount: string;
  salesMinor: string;
};

export type ExpensesByDay = {
  day: string;
  expenseCount: string;
  expensesMinor: string;
};

export type PaymentsByMethod = {
  day: string;
  methodCode: string;
  methodName: string;
  paymentCount: string;
  paymentsRecordedMinor: string;
};

export type OutstandingCharge = {
  chargeId: string;
  sourceId: string;
  status: string;
  currency: string;
  totalMinor: string;
  allocatedMinor: string;
  remainingMinor: string;
  issuedAt: string;
};

export type DeviceUsage = {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  sessionCount: string;
  gamingBilledMinor: string;
};

export type CashierActivity = {
  actorUserId: string;
  displayName: string;
  paymentCount: string;
  paymentsRecordedMinor: string;
};

export type PilotOperationsReport = {
  /** Selected branch, or null when aggregating every branch the actor can VIEW. */
  branchId: string | null;
  from: string;
  to: string;
  timezoneNote: string;
  terminology: {
    gamingBilledMinor: "Sum of fully paid completed gaming sessions. Not unpaid bills or POS sales.";
    paymentsRecordedMinor: "Sum of recorded finance_payments.amount_minor. Not called revenue.";
  };
  sessionsByDay: SessionsByDay[];
  productSalesByDay: ProductSalesByDay[];
  expensesByDay: ExpensesByDay[];
  paymentsByMethod: PaymentsByMethod[];
  outstandingCharges: OutstandingCharge[];
  deviceUsage: DeviceUsage[];
  cashierActivity: CashierActivity[];
};

export type BranchDashboardTotals = {
  finalizedGamingMinor: bigint;
  completedProductSalesMinor: bigint;
  postedExpensesMinor: bigint;
  grossHallProfitMinor: bigint;
};

/**
 * All-time branch totals for the owner dashboard. The displayed hall figure
 * follows the requested operational formula; it is not accounting P&L because
 * product purchase cost is not tracked yet.
 */
export async function getBranchDashboardTotals(
  db: AppDatabase,
  actor: OrganizationActor,
  input: { branchId: string },
): Promise<BranchDashboardTotals> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  assertPermission(actor, PERMISSIONS.posOrdersRead);
  assertPermission(actor, PERMISSIONS.financeExpensesRead);
  requireBranchAccess(actor, input.branchId, "VIEW");

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const [gamingRows, productRows, expenseRows] = await Promise.all([
      tx
        .select({
          totalMinor: sql<string>`coalesce(sum(${gamingSessions.gamingTotalMinor}), 0)::text`,
        })
        .from(gamingSessions)
        .innerJoin(
          financeCharges,
          and(
            eq(financeCharges.organizationId, gamingSessions.organizationId),
            eq(financeCharges.sourceId, gamingSessions.id),
            eq(financeCharges.sourceModule, "gaming"),
            eq(financeCharges.sourceType, "session"),
          ),
        )
        .where(
          and(
            eq(gamingSessions.organizationId, actor.organizationId),
            eq(gamingSessions.branchId, input.branchId),
            eq(gamingSessions.status, "COMPLETED"),
            eq(financeCharges.status, "PAID"),
          ),
        ),
      tx
        .select({ totalMinor: sql<string>`coalesce(sum(${posOrders.totalMinor}), 0)::text` })
        .from(posOrders)
        .innerJoin(
          financeCharges,
          and(
            eq(financeCharges.id, posOrders.chargeId),
            eq(financeCharges.organizationId, posOrders.organizationId),
          ),
        )
        .where(
          and(
            eq(posOrders.organizationId, actor.organizationId),
            eq(posOrders.branchId, input.branchId),
            eq(posOrders.status, "COMPLETED"),
            eq(financeCharges.status, "PAID"),
          ),
        ),
      tx
        .select({ totalMinor: sql<string>`coalesce(sum(${financeExpenses.amountMinor}), 0)::text` })
        .from(financeExpenses)
        .where(
          and(
            eq(financeExpenses.organizationId, actor.organizationId),
            eq(financeExpenses.branchId, input.branchId),
            eq(financeExpenses.status, "POSTED"),
          ),
        ),
    ]);

    const finalizedGamingMinor = BigInt(asText(gamingRows[0]?.totalMinor));
    const completedProductSalesMinor = BigInt(asText(productRows[0]?.totalMinor));
    const postedExpensesMinor = BigInt(asText(expenseRows[0]?.totalMinor));
    return {
      finalizedGamingMinor,
      completedProductSalesMinor,
      postedExpensesMinor,
      grossHallProfitMinor: finalizedGamingMinor + completedProductSalesMinor - postedExpensesMinor,
    };
  });
}

function assertReportPermissions(actor: OrganizationActor): void {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  assertPermission(actor, PERMISSIONS.financePaymentsRead);
  assertPermission(actor, PERMISSIONS.posOrdersRead);
  assertPermission(actor, PERMISSIONS.financeExpensesRead);
}

function assertReportAccess(actor: OrganizationActor, branchId: string): void {
  assertReportPermissions(actor);
  requireBranchAccess(actor, branchId, "VIEW");
}

function visibleReportBranchIds(actor: OrganizationActor, branchId: string | undefined): string[] {
  if (branchId) {
    assertReportAccess(actor, branchId);
    return [branchId];
  }
  assertReportPermissions(actor);
  return grantedBranchIds(actor, "VIEW");
}

/**
 * All completed payments recorded for the visible branch scope. This is a
 * collection total, not accounting revenue or profit.
 */
export async function getRecordedPaymentsTotal(
  db: AppDatabase,
  actor: OrganizationActor,
  input: { branchId?: string } = {},
): Promise<bigint> {
  const visibleBranches = visibleReportBranchIds(actor, input.branchId);
  if (visibleBranches.length === 0) return 0n;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select({
        totalMinor: sql<string>`coalesce(sum(${financePayments.amountMinor}), 0)::text`,
      })
      .from(financePayments)
      .where(
        and(
          eq(financePayments.organizationId, actor.organizationId),
          inArray(financePayments.branchId, visibleBranches),
          eq(financePayments.status, "COMPLETED"),
        ),
      );
    return BigInt(asText(rows[0]?.totalMinor));
  });
}

function assertRange(from: Date, to: Date): void {
  if (!(from instanceof Date) || Number.isNaN(from.getTime()) || !(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new ValidationError("Report range is invalid");
  }
  if (to.getTime() <= from.getTime()) {
    throw new ValidationError("Report 'to' must be after 'from'");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ValidationError("Report range cannot exceed 31 days");
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (value == null) return "0";
  return String(value);
}

function sqlIanaTimeZone(timeZone: string) {
  const zone = requireIanaTimeZone(timeZone);
  return sql.raw(`'${zone.replace(/'/g, "")}'`);
}

function calendarDaySql(
  column:
    | typeof gamingSessions.endedAt
    | typeof financePayments.receivedAt
    | typeof posOrders.completedAt
    | typeof financeExpenses.occurredAt,
  timeZone: string,
) {
  return sql`to_char((${column} AT TIME ZONE ${sqlIanaTimeZone(timeZone)})::date, 'YYYY-MM-DD')`;
}

/**
 * Pilot operational report. Uses canonical finalized billing and recorded
 * payments. Calendar days use the organization's business timezone.
 * Does not compute P&L, tax, or accounting revenue.
 */
export async function getPilotOperationsReport(
  db: AppDatabase,
  actor: OrganizationActor,
  input: PilotReportInput & { timeZone?: string },
): Promise<PilotOperationsReport> {
  const visibleBranches = visibleReportBranchIds(actor, input.branchId);
  assertRange(input.from, input.to);

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const org = actor.organizationId;
    const branch = input.branchId ?? null;
    const from = input.from;
    const to = input.to;
    let timeZone = input.timeZone ? requireIanaTimeZone(input.timeZone) : null;
    if (!timeZone) {
      const orgRows = await tx
        .select({ timezone: coreOrganizations.timezone })
        .from(coreOrganizations)
        .where(eq(coreOrganizations.id, org))
        .limit(1);
      timeZone = requireIanaTimeZone(orgRows[0]?.timezone, "UTC");
    }
    if (visibleBranches.length === 0) {
      return {
        branchId: branch,
        from: from.toISOString(),
        to: to.toISOString(),
        timezoneNote: timeZone,
        terminology: {
          gamingBilledMinor: "Sum of fully paid completed gaming sessions. Not unpaid bills or POS sales.",
          paymentsRecordedMinor: "Sum of recorded finance_payments.amount_minor. Not called revenue.",
        },
        sessionsByDay: [],
        productSalesByDay: [],
        expensesByDay: [],
        paymentsByMethod: [],
        outstandingCharges: [],
        deviceUsage: [],
        cashierActivity: [],
      };
    }
    const sessionDay = calendarDaySql(gamingSessions.endedAt, timeZone);
    const paymentDay = calendarDaySql(financePayments.receivedAt, timeZone);
    const productDay = calendarDaySql(posOrders.completedAt, timeZone);
    const expenseDay = calendarDaySql(financeExpenses.occurredAt, timeZone);

    const sessionsByDay = await tx
      .select({
        day: sessionDay,
        sessionCount: sql<string>`count(*)::text`,
        completedCount: sql<string>`count(*)::text`,
        billedSessionCount: sql<string>`count(*) FILTER (WHERE ${financeCharges.status} = 'PAID')::text`,
        gamingBilledMinor: sql<string>`coalesce(sum(${gamingSessions.gamingTotalMinor}) FILTER (WHERE ${financeCharges.status} = 'PAID'), 0)::text`,
      })
      .from(gamingSessions)
      .leftJoin(
        financeCharges,
        and(
          eq(financeCharges.organizationId, gamingSessions.organizationId),
          eq(financeCharges.sourceId, gamingSessions.id),
          eq(financeCharges.sourceModule, "gaming"),
          eq(financeCharges.sourceType, "session"),
        ),
      )
      .where(
        and(
          eq(gamingSessions.organizationId, org),
          inArray(gamingSessions.branchId, visibleBranches),
          eq(gamingSessions.status, "COMPLETED"),
          isNotNull(gamingSessions.endedAt),
          gte(gamingSessions.endedAt, from),
          lt(gamingSessions.endedAt, to),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const productSalesByDay = await tx
      .select({
        day: productDay,
        orderCount: sql<string>`count(*)::text`,
        salesMinor: sql<string>`coalesce(sum(${posOrders.totalMinor}), 0)::text`,
      })
      .from(posOrders)
      .innerJoin(
        financeCharges,
        and(
          eq(financeCharges.id, posOrders.chargeId),
          eq(financeCharges.organizationId, posOrders.organizationId),
        ),
      )
      .where(
        and(
          eq(posOrders.organizationId, org),
          inArray(posOrders.branchId, visibleBranches),
          eq(posOrders.status, "COMPLETED"),
          eq(financeCharges.status, "PAID"),
          isNotNull(posOrders.completedAt),
          gte(posOrders.completedAt, from),
          lt(posOrders.completedAt, to),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const expensesByDay = await tx
      .select({
        day: expenseDay,
        expenseCount: sql<string>`count(*)::text`,
        expensesMinor: sql<string>`coalesce(sum(${financeExpenses.amountMinor}), 0)::text`,
      })
      .from(financeExpenses)
      .where(
        and(
          eq(financeExpenses.organizationId, org),
          inArray(financeExpenses.branchId, visibleBranches),
          eq(financeExpenses.status, "POSTED"),
          gte(financeExpenses.occurredAt, from),
          lt(financeExpenses.occurredAt, to),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const paymentsByMethod = await tx
      .select({
        day: paymentDay,
        methodCode: financePaymentMethods.code,
        methodName: financePaymentMethods.name,
        paymentCount: sql<string>`count(*)::text`,
        paymentsRecordedMinor: sql<string>`coalesce(sum(${financePayments.amountMinor}), 0)::text`,
      })
      .from(financePayments)
      .innerJoin(
        financePaymentMethods,
        and(
          eq(financePaymentMethods.id, financePayments.paymentMethodId),
          eq(financePaymentMethods.organizationId, financePayments.organizationId),
        ),
      )
      .where(
        and(
          eq(financePayments.organizationId, org),
          inArray(financePayments.branchId, visibleBranches),
          eq(financePayments.status, "COMPLETED"),
          gte(financePayments.receivedAt, from),
          lt(financePayments.receivedAt, to),
        ),
      )
      .groupBy(sql`1`, financePaymentMethods.code, financePaymentMethods.name)
      .orderBy(sql`1`, financePaymentMethods.code);

    const outstandingRows = await tx
      .select({
        chargeId: financeCharges.id,
        sourceId: financeCharges.sourceId,
        status: financeCharges.status,
        currency: financeCharges.currency,
        totalMinor: sql<string>`${financeCharges.totalMinor}::text`,
        allocatedMinor: sql<string>`coalesce(sum(${financePaymentAllocations.amountMinor}), 0)::text`,
        issuedAt: financeCharges.issuedAt,
      })
      .from(financeCharges)
      .leftJoin(
        financePaymentAllocations,
        and(
          eq(financePaymentAllocations.chargeId, financeCharges.id),
          eq(financePaymentAllocations.organizationId, financeCharges.organizationId),
        ),
      )
      .where(
        and(
          eq(financeCharges.organizationId, org),
          inArray(financeCharges.branchId, visibleBranches),
          sql`${financeCharges.status} IN ('OPEN', 'PARTIALLY_PAID')`,
          gte(financeCharges.issuedAt, from),
          lt(financeCharges.issuedAt, to),
        ),
      )
      .groupBy(
        financeCharges.id,
        financeCharges.sourceId,
        financeCharges.status,
        financeCharges.currency,
        financeCharges.totalMinor,
        financeCharges.issuedAt,
      )
      .orderBy(financeCharges.issuedAt);

    const deviceUsage = await tx
      .select({
        deviceId: gamingDevices.id,
        deviceCode: gamingDevices.code,
        deviceName: gamingDevices.name,
        sessionCount: sql<string>`count(distinct ${gamingSessions.id})::text`,
        gamingBilledMinor: sql<string>`coalesce(sum(${gamingSessions.gamingTotalMinor}) FILTER (WHERE ${gamingSessions.billingFinalizedAt} IS NOT NULL), 0)::text`,
      })
      .from(gamingSessionSegments)
      .innerJoin(
        gamingSessions,
        and(
          eq(gamingSessions.id, gamingSessionSegments.sessionId),
          eq(gamingSessions.organizationId, gamingSessionSegments.organizationId),
        ),
      )
      .innerJoin(
        gamingDevices,
        and(
          eq(gamingDevices.id, gamingSessionSegments.deviceId),
          eq(gamingDevices.organizationId, gamingSessionSegments.organizationId),
        ),
      )
      .innerJoin(
        financeCharges,
        and(
          eq(financeCharges.organizationId, gamingSessions.organizationId),
          eq(financeCharges.sourceId, gamingSessions.id),
          eq(financeCharges.sourceModule, "gaming"),
          eq(financeCharges.sourceType, "session"),
          eq(financeCharges.status, "PAID"),
        ),
      )
      .where(
        and(
          eq(gamingSessionSegments.organizationId, org),
          inArray(gamingSessionSegments.branchId, visibleBranches),
          isNotNull(gamingSessions.endedAt),
          gte(gamingSessions.endedAt, from),
          lt(gamingSessions.endedAt, to),
        ),
      )
      .groupBy(gamingDevices.id, gamingDevices.code, gamingDevices.name)
      .orderBy(gamingDevices.code);

    const cashierActivity = await tx
      .select({
        actorUserId: financePayments.createdBy,
        displayName: coreUsers.displayName,
        paymentCount: sql<string>`count(*)::text`,
        paymentsRecordedMinor: sql<string>`coalesce(sum(${financePayments.amountMinor}), 0)::text`,
      })
      .from(financePayments)
      .innerJoin(coreUsers, eq(coreUsers.id, financePayments.createdBy))
      .where(
        and(
          eq(financePayments.organizationId, org),
          inArray(financePayments.branchId, visibleBranches),
          eq(financePayments.status, "COMPLETED"),
          gte(financePayments.receivedAt, from),
          lt(financePayments.receivedAt, to),
        ),
      )
      .groupBy(financePayments.createdBy, coreUsers.displayName)
      .orderBy(coreUsers.displayName);

    const outstandingCharges: OutstandingCharge[] = outstandingRows.map((row) => {
      const total = BigInt(asText(row.totalMinor));
      const allocated = BigInt(asText(row.allocatedMinor));
      const remaining = total > allocated ? total - allocated : 0n;
      return {
        chargeId: row.chargeId,
        sourceId: row.sourceId,
        status: row.status,
        currency: row.currency,
        totalMinor: total.toString(),
        allocatedMinor: allocated.toString(),
        remainingMinor: remaining.toString(),
        issuedAt: row.issuedAt.toISOString(),
      };
    });

    return {
      branchId: branch,
      from: from.toISOString(),
      to: to.toISOString(),
      timezoneNote: timeZone,
      terminology: {
        gamingBilledMinor: "Sum of fully paid completed gaming sessions. Not unpaid bills or POS sales.",
        paymentsRecordedMinor: "Sum of recorded finance_payments.amount_minor. Not called revenue.",
      },
      sessionsByDay: sessionsByDay.map((row) => ({
        day: asText(row.day),
        sessionCount: asText(row.sessionCount),
        completedCount: asText(row.completedCount),
        billedSessionCount: asText(row.billedSessionCount),
        gamingBilledMinor: asText(row.gamingBilledMinor),
      })),
      productSalesByDay: productSalesByDay.map((row) => ({
        day: asText(row.day),
        orderCount: asText(row.orderCount),
        salesMinor: asText(row.salesMinor),
      })),
      expensesByDay: expensesByDay.map((row) => ({
        day: asText(row.day),
        expenseCount: asText(row.expenseCount),
        expensesMinor: asText(row.expensesMinor),
      })),
      paymentsByMethod: paymentsByMethod.map((row) => ({
        day: asText(row.day),
        methodCode: row.methodCode,
        methodName: row.methodName,
        paymentCount: asText(row.paymentCount),
        paymentsRecordedMinor: asText(row.paymentsRecordedMinor),
      })),
      outstandingCharges,
      deviceUsage: deviceUsage.map((row) => ({
        deviceId: row.deviceId,
        deviceCode: row.deviceCode,
        deviceName: row.deviceName,
        sessionCount: asText(row.sessionCount),
        gamingBilledMinor: asText(row.gamingBilledMinor),
      })),
      cashierActivity: cashierActivity.map((row) => ({
        actorUserId: row.actorUserId,
        displayName: row.displayName,
        paymentCount: asText(row.paymentCount),
        paymentsRecordedMinor: asText(row.paymentsRecordedMinor),
      })),
    };
  });
}

export function pilotReportToCsv(report: PilotOperationsReport): string {
  const sections: string[] = [];
  sections.push(
    toCsv(
      ["section", "day", "session_count", "completed_count", "billed_session_count", "gaming_billed_minor"],
      report.sessionsByDay.map((row) => [
        "sessions_by_day",
        row.day,
        row.sessionCount,
        row.completedCount,
        row.billedSessionCount,
        row.gamingBilledMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "day", "method_code", "method_name", "payment_count", "payments_recorded_minor"],
      report.paymentsByMethod.map((row) => [
        "payments_by_method",
        row.day,
        row.methodCode,
        row.methodName,
        row.paymentCount,
        row.paymentsRecordedMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "day", "paid_order_count", "paid_product_sales_minor"],
      report.productSalesByDay.map((row) => [
        "paid_product_sales_by_day",
        row.day,
        row.orderCount,
        row.salesMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "day", "expense_count", "posted_expenses_minor"],
      report.expensesByDay.map((row) => [
        "posted_expenses_by_day",
        row.day,
        row.expenseCount,
        row.expensesMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "charge_id", "source_id", "status", "currency", "total_minor", "allocated_minor", "remaining_minor"],
      report.outstandingCharges.map((row) => [
        "outstanding",
        row.chargeId,
        row.sourceId,
        row.status,
        row.currency,
        row.totalMinor,
        row.allocatedMinor,
        row.remainingMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "device_code", "device_name", "session_count", "gaming_billed_minor"],
      report.deviceUsage.map((row) => [
        "device_usage",
        row.deviceCode,
        row.deviceName,
        row.sessionCount,
        row.gamingBilledMinor,
      ]),
    ).trimEnd(),
  );
  sections.push(
    toCsv(
      ["section", "actor_user_id", "display_name", "payment_count", "payments_recorded_minor"],
      report.cashierActivity.map((row) => [
        "cashier_activity",
        row.actorUserId,
        row.displayName,
        row.paymentCount,
        row.paymentsRecordedMinor,
      ]),
    ).trimEnd(),
  );
  return `${sections.join("\r\n")}\r\n`;
}
