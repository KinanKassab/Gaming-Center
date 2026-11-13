import { PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import { listCustomers } from "@/modules/customers";
import {
  firstSearchParam,
  listDevices,
  listSessionBranches,
  listSessions,
  resolveReportBranchId,
  shouldShowBranchPicker,
} from "@/modules/gaming";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { getPilotOperationsReport } from "@/modules/reports";
import { formatMinorAmount } from "@/core/money";
import { requireIanaTimeZone } from "@/core/time";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { PageHeader, StatCard, EmptyState, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { formatDateTime } from "@/app/_lib/display";
import { paymentMethodLabel } from "@/i18n/payment-method";
import { getRequestLocale } from "@/i18n/resolve";
import { t, type MessageKey } from "@/i18n/t";
import Link from "next/link";
import { SessionRecords } from "@/app/admin/gaming/_components/session-records";
import {
  CUSTOM_REPORT_RANGE,
  DEFAULT_REPORT_RANGE,
  REPORT_RANGE_IDS,
  reportsPageHref,
  resolveReportWindow,
} from "@/ui/report-range";

export default async function PilotReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const { db, organization } = await getAdminPageContext();
  if (!organization) {
    return (
      <SelectOrganizationNotice
        title={t(locale, "org.chooseNoticeTitle")}
        body={t(locale, "org.chooseNoticeBody")}
      />
    );
  }
  const permissions = organization.actor.permissions;
  if (!permissions.includes(PERMISSIONS.gamingSessionsRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.reports")} />;
  }

  const query = await searchParams;
  const profile = await getOrganizationProfile(db, organization.actor);
  const currency = profile.defaultCurrency;
  const timeZone = requireIanaTimeZone(profile.timezone);
  const branches = await listSessionBranches(db, organization.actor, "VIEW");
  const branchId = resolveReportBranchId(
    firstSearchParam(query.branchId),
    branches.map((branch) => branch.id),
  );
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const reportWindow = resolveReportWindow({
    range: firstSearchParam(query.range),
    from: firstSearchParam(query.from),
    to: firstSearchParam(query.to),
    timeZone,
  });
  const { from, to, custom, fromLocal, toLocal, rangeId: range } = reportWindow;
  const statusRaw = firstSearchParam(query.status);
  const status =
    statusRaw === "ACTIVE" ||
    statusRaw === "PAUSED" ||
    statusRaw === "COMPLETED" ||
    statusRaw === "CANCELLED"
      ? statusRaw
      : undefined;
  const page = Math.max(1, Number(firstSearchParam(query.page) || "1") || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const canFinance =
    permissions.includes(PERMISSIONS.financePaymentsRead) &&
    permissions.includes(PERMISSIONS.posOrdersRead) &&
    permissions.includes(PERMISSIONS.financeExpensesRead);
  const filterQuery = {
    range: custom ? CUSTOM_REPORT_RANGE : range === DEFAULT_REPORT_RANGE ? undefined : range,
    from: custom ? fromLocal : undefined,
    to: custom ? toLocal : undefined,
    branchId: branchId ?? undefined,
    status,
  };

  const report =
    canFinance && branches.length > 0
      ? await getPilotOperationsReport(db, organization.actor, {
          ...(branchId ? { branchId } : {}),
          from,
          to,
          timeZone,
        })
      : null;

  const sessions = await listSessions(db, organization.actor, {
    branchId: branchId ?? undefined,
    status,
    from,
    to,
    limit,
    offset,
  });
  const devices = permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listDevices(db, organization.actor)
    : [];
  const deviceNameById = new Map(devices.map((device) => [device.id, device.name]));
  const customers = permissions.includes(PERMISSIONS.customersRead)
    ? await listCustomers(db, organization.actor, { limit: 100 })
    : [];
  const customerNameById = new Map(customers.map((customer) => [customer.id, customer.displayName]));

  const csvParams = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    format: "csv",
  });
  if (branchId) csvParams.set("branchId", branchId);
  const csvHref = canFinance && branches.length > 0 ? `/api/reports?${csvParams.toString()}` : null;
  const sessionsEmpty = selectedBranch
    ? t(locale, "reports.noSessionsInBranch", { branch: selectedBranch.name })
    : t(locale, "reports.noSessions");
  const paidPlayMinor = report?.sessionsByDay.reduce((sum, row) => sum + BigInt(row.gamingBilledMinor), 0n) ?? 0n;
  const paidSessionCount = report?.sessionsByDay.reduce((sum, row) => sum + Number(row.billedSessionCount), 0) ?? 0;
  const paidProductSalesMinor = report?.productSalesByDay.reduce((sum, row) => sum + BigInt(row.salesMinor), 0n) ?? 0n;
  const postedExpensesMinor = report?.expensesByDay.reduce((sum, row) => sum + BigInt(row.expensesMinor), 0n) ?? 0n;
  const netOperatingMinor = paidPlayMinor + paidProductSalesMinor - postedExpensesMinor;

  return (
    <>
      <PageHeader title={t(locale, "reports.title")} description={t(locale, "reports.description")} />

      <section className="card">
        <div className="ui-pills" role="list">
          {REPORT_RANGE_IDS.map((id) => {
            const href = reportsPageHref({
              range: id,
              branchId: branchId ?? undefined,
              status,
            });
            const active = !custom && id === range;
            return (
              <Link
                key={id}
                href={href}
                className={`ui-pill${active ? " active" : ""}`}
                {...(active ? { "aria-current": "true" as const } : {})}
              >
                {t(locale, `reports.range.${id}` as MessageKey)}
              </Link>
            );
          })}
          <Link
            href={reportsPageHref({
              range: CUSTOM_REPORT_RANGE,
              from: fromLocal,
              to: toLocal,
              branchId: branchId ?? undefined,
              status,
            })}
            className={`ui-pill${custom ? " active" : ""}`}
            {...(custom ? { "aria-current": "true" as const } : {})}
          >
            {t(locale, "reports.range.custom")}
          </Link>
        </div>
        <form className="toolbar" method="get">
          {custom ? <input type="hidden" name="range" value={CUSTOM_REPORT_RANGE} /> : null}
          {!custom && range !== DEFAULT_REPORT_RANGE ? <input type="hidden" name="range" value={range} /> : null}
          {custom ? (
            <>
              <label>
                {t(locale, "reports.from")}
                <input type="datetime-local" name="from" defaultValue={fromLocal} required />
              </label>
              <label>
                {t(locale, "reports.to")}
                <input type="datetime-local" name="to" defaultValue={toLocal} required />
              </label>
            </>
          ) : null}
          <BranchSelectField
            branches={branches}
            label={t(locale, "reports.branch")}
            name="branchId"
            defaultValue={branchId ?? ""}
            emptyOptionLabel={t(locale, "reports.allBranches")}
            includeWhenSingle="omit"
          />
          <label>
            {t(locale, "sessions.status")}
            <select name="status" defaultValue={status ?? ""}>
              <option value="">{t(locale, "common.all")}</option>
              <option value="ACTIVE">{t(locale, "status.session.ACTIVE")}</option>
              <option value="PAUSED">{t(locale, "status.session.PAUSED")}</option>
              <option value="COMPLETED">{t(locale, "status.session.COMPLETED")}</option>
              <option value="CANCELLED">{t(locale, "status.session.CANCELLED")}</option>
            </select>
          </label>
          <div className="toolbar-actions">
            <button type="submit">{t(locale, "common.filter")}</button>
            {csvHref ? (
              <a className="btn btn-secondary" href={csvHref}>
                {t(locale, "reports.downloadCsv")}
              </a>
            ) : null}
          </div>
        </form>
        {custom ? <p className="hint">{t(locale, "reports.customHint")}</p> : null}
        {shouldShowBranchPicker(branches.length) ? (
          <p className="hint">
            {selectedBranch
              ? t(locale, "reports.scopeBranch", { branch: selectedBranch.name })
              : t(locale, "reports.scopeAll")}
          </p>
        ) : null}
      </section>

      {canFinance && branches.length === 0 ? <EmptyState title={t(locale, "reports.noBranch")} /> : null}

      {report ? (
        <>
          <div className="stat-grid report-summary-grid">
            <StatCard
              label={t(locale, "reports.paidPlay")}
              value={formatMinorAmount(paidPlayMinor, currency)}
              hint={t(locale, "reports.paidSessionsHint", { count: paidSessionCount })}
            />
            <StatCard
              label={t(locale, "reports.paidProductSales")}
              value={formatMinorAmount(paidProductSalesMinor, currency)}
              hint={t(locale, "reports.paidProductsHint")}
            />
            <StatCard
              label={t(locale, "reports.postedExpenses")}
              value={formatMinorAmount(postedExpensesMinor, currency)}
              hint={t(locale, "reports.postedExpensesHint")}
            />
            <StatCard
              label={t(locale, "reports.netOperating")}
              value={formatMinorAmount(netOperatingMinor, currency)}
              hint={t(locale, "reports.netOperatingHint")}
            />
          </div>

          <section className="card table-scroll">
            <h2>{t(locale, "reports.sessionsByDay")}</h2>
            <p>{t(locale, "reports.sessionsHint")}</p>
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "reports.day")}</th>
                  <th>{t(locale, "reports.closedSessions")}</th>
                  <th>{t(locale, "reports.paidSessions")}</th>
                  <th>{t(locale, "reports.paidPlay")}</th>
                </tr>
              </thead>
              <tbody>
                {report.sessionsByDay.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{sessionsEmpty}</td>
                  </tr>
                ) : (
                  report.sessionsByDay.map((row) => (
                    <tr key={row.day}>
                      <td>{row.day}</td>
                      <td>{row.completedCount}</td>
                      <td>{row.billedSessionCount}</td>
                      <td>{formatMinorAmount(row.gamingBilledMinor, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <div className="report-detail-grid">
            <section className="card table-scroll">
              <h2>{t(locale, "reports.productSales")}</h2>
              <table>
                <thead><tr><th>{t(locale, "reports.day")}</th><th>{t(locale, "reports.orders")}</th><th>{t(locale, "reports.paidProductSales")}</th></tr></thead>
                <tbody>
                  {report.productSalesByDay.length === 0 ? (
                    <tr><td colSpan={3}>{t(locale, "reports.noProductSales")}</td></tr>
                  ) : report.productSalesByDay.map((row) => (
                    <tr key={row.day}><td>{row.day}</td><td>{row.orderCount}</td><td>{formatMinorAmount(row.salesMinor, currency)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card table-scroll">
              <h2>{t(locale, "reports.expenses")}</h2>
              <table>
                <thead><tr><th>{t(locale, "reports.day")}</th><th>{t(locale, "reports.count")}</th><th>{t(locale, "reports.postedExpenses")}</th></tr></thead>
                <tbody>
                  {report.expensesByDay.length === 0 ? (
                    <tr><td colSpan={3}>{t(locale, "reports.noExpenses")}</td></tr>
                  ) : report.expensesByDay.map((row) => (
                    <tr key={row.day}><td>{row.day}</td><td>{row.expenseCount}</td><td>{formatMinorAmount(row.expensesMinor, currency)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="card table-scroll">
            <h2>{t(locale, "reports.payments")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "reports.day")}</th>
                  <th>{t(locale, "reports.method")}</th>
                  <th>{t(locale, "reports.count")}</th>
                  <th>{t(locale, "reports.recorded")}</th>
                </tr>
              </thead>
              <tbody>
                {report.paymentsByMethod.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{t(locale, "reports.noPayments")}</td>
                  </tr>
                ) : (
                  report.paymentsByMethod.map((row) => (
                    <tr key={`${row.day}-${row.methodCode}`}>
                      <td>{row.day}</td>
                      <td>{paymentMethodLabel(row.methodCode, locale, row.methodName)}</td>
                      <td>{row.paymentCount}</td>
                      <td>{formatMinorAmount(row.paymentsRecordedMinor, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="card table-scroll">
            <h2>{t(locale, "reports.unpaidPartial")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "common.status")}</th>
                  <th>{t(locale, "sessions.total")}</th>
                  <th>{t(locale, "checkout.paid")}</th>
                  <th>{t(locale, "checkout.remaining")}</th>
                  <th>{t(locale, "reports.issued")}</th>
                </tr>
              </thead>
              <tbody>
                {report.outstandingCharges.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{t(locale, "reports.noOpenCharges")}</td>
                  </tr>
                ) : (
                  report.outstandingCharges.map((row) => (
                    <tr key={row.chargeId}>
                      <td>
                        {row.status === "OPEN"
                          ? t(locale, "status.settlement.OPEN")
                          : row.status === "PARTIALLY_PAID"
                            ? t(locale, "status.settlement.PARTIALLY_PAID")
                            : row.status}
                      </td>
                      <td>{formatMinorAmount(row.totalMinor, row.currency)}</td>
                      <td>{formatMinorAmount(row.allocatedMinor, row.currency)}</td>
                      <td>{formatMinorAmount(row.remainingMinor, row.currency)}</td>
                      <td>{formatDateTime(row.issuedAt, locale, timeZone)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

        </>
      ) : null}

      <section className="card">
        <h2>{t(locale, "sessions.title")}</h2>
        <SessionRecords
          locale={locale}
          sessions={sessions}
          deviceNameById={deviceNameById}
          customerNameById={customerNameById}
          page={page}
          limit={limit}
          query={filterQuery}
        />
      </section>
    </>
  );
}
