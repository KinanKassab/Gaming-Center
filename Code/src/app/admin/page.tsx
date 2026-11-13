import { cookies } from "next/headers";
import Link from "next/link";
import { listUserMemberships, listAuditLogs, PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import { listFloor, listSessionBranches, shouldShowBranchPicker } from "@/modules/gaming";
import { getBranchDashboardTotals, getPilotOperationsReport } from "@/modules/reports";
import { sumPostedExpenses } from "@/modules/finance";
import { getGamingCenterSetupStatus } from "@/modules/onboarding/status";
import {
  GUIDED_SETUP_DONE_COOKIE,
  isGuidedSetupCompleteForOrg,
  shouldPresentGuidedSetup,
} from "@/modules/onboarding/presentation";
import { addCalendarDaysInTimeZone, requireIanaTimeZone, startOfDayInTimeZone } from "@/core/time";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { HardRedirect } from "@/app/_components/hard-redirect";
import { ActionButton } from "@/app/admin/_components/controls";
import { GuidedSetupHost } from "@/app/admin/_components/guided-setup-host";
import { WithdrawalForm } from "@/app/admin/_components/withdrawal-form";
import { loadOnboardingWizardLists } from "@/app/admin/onboarding/load-wizard-data";
import { PageHeader, StatCard, EmptyState, StatusBadge } from "@/app/_components/page-ui";
import { formatAuditLine, membershipStatusLabel } from "@/app/_lib/display";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  const locale = await getRequestLocale();
  const { db, viewer, organization } = await getAdminPageContext();
  if (!viewer) return <HardRedirect href="/login" />;
  const memberships = await listUserMemberships(db, viewer.user.id);
  const query = await searchParams;

  if (!organization) {
    return (
      <>
        <PageHeader title={t(locale, "org.chooseTitle")} description={t(locale, "org.chooseBody")} />
        <section className="card">
          {memberships.length === 0 ? (
            <EmptyState
              title={t(locale, "org.noOrgTitle")}
              body={t(locale, "org.noOrgBody")}
              action={
                <Link className="btn" href="/admin/onboarding">
                  {t(locale, "org.startSetup")}
                </Link>
              }
            />
          ) : (
            <div className="card-grid">
              {memberships.map((membership) => (
                <article key={membership.membershipId} className="record-card">
                  <h2>{membership.organizationName}</h2>
                  <p>
                    <StatusBadge>
                      {membership.status === "ACTIVE"
                        ? t(locale, "org.active")
                        : membershipStatusLabel(membership.status, locale)}
                    </StatusBadge>
                  </p>
                  {membership.status === "SUSPENDED" ? (
                    <em>{t(locale, "org.suspended")}</em>
                  ) : (
                    <ActionButton
                      action="/api/organizations/select"
                      body={{ organizationId: membership.organizationId }}
                      label={membership.status === "INVITED" ? t(locale, "org.acceptEnter") : t(locale, "org.enter")}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  const profile = await getOrganizationProfile(db, organization.actor);
  const permissions = organization.actor.permissions;
  const canFloor = permissions.includes(PERMISSIONS.gamingSessionsRead);
  const canReports =
    permissions.includes(PERMISSIONS.gamingSessionsRead) &&
    permissions.includes(PERMISSIONS.financePaymentsRead) &&
    permissions.includes(PERMISSIONS.posOrdersRead) &&
    permissions.includes(PERMISSIONS.financeExpensesRead);
  const canExpensesRead = permissions.includes(PERMISSIONS.financeExpensesRead);
  const canExpensesCreate = permissions.includes(PERMISSIONS.financeExpensesCreate);
  const canDashboardTotals =
    permissions.includes(PERMISSIONS.posOrdersRead) &&
    permissions.includes(PERMISSIONS.financeExpensesRead) &&
    permissions.includes(PERMISSIONS.gamingSessionsRead);
  const canSetup =
    permissions.includes(PERMISSIONS.branchesManage) || permissions.includes(PERMISSIONS.gamingMasterManage);
  const canAudit = permissions.includes(PERMISSIONS.auditRead);

  const setup = canSetup ? await getGamingCenterSetupStatus(db, organization.actor) : null;
  const guidedSetupCookie = (await cookies()).get(GUIDED_SETUP_DONE_COOKIE)?.value;
  const guidedSetupComplete = isGuidedSetupCompleteForOrg(guidedSetupCookie, organization.organization.id);
  const showGuidedSetup = Boolean(
    setup &&
      canSetup &&
      shouldPresentGuidedSetup({
        completed: guidedSetupComplete,
        operationallyReady: setup.operationallyReady,
      }),
  );
  const wizardLists = showGuidedSetup ? await loadOnboardingWizardLists(db, organization) : null;
  const branches = canFloor
    ? (await listSessionBranches(db, organization.actor, "VIEW")).filter((branch) => branch.status !== "ARCHIVED")
    : [];
  const branchId = branches.some((branch) => branch.id === query.branchId) ? query.branchId : branches[0]?.id;
  const floor = branchId && canFloor ? await listFloor(db, organization.actor, { branchId }) : [];
  const occupied = floor.filter((tile) => tile.occupancy === "OCCUPIED").length;
  const available = floor.filter((tile) => tile.occupancy === "AVAILABLE").length;
  const maintenance = floor.filter((tile) => tile.operationalStatus === "MAINTENANCE").length;

  const timezone = requireIanaTimeZone(profile.timezone);
  const from = startOfDayInTimeZone(timezone);
  const to = addCalendarDaysInTimeZone(from, 1, timezone);
  const report =
    branchId && canReports
      ? await getPilotOperationsReport(db, organization.actor, { branchId, from, to, timeZone: timezone })
      : null;
  const billedToday = report
    ? report.sessionsByDay.reduce((sum, row) => sum + BigInt(row.gamingBilledMinor), 0n)
    : 0n;
  const expensesToday =
    branchId && canExpensesRead
      ? await sumPostedExpenses(db, organization.actor, { branchId, from, to })
      : null;
  const dashboardTotals =
    branchId && canDashboardTotals
      ? await getBranchDashboardTotals(db, organization.actor, { branchId })
      : null;
  const outstanding = report?.outstandingCharges.length ?? 0;
  const currency = profile.defaultCurrency;
  const canWithdraw =
    Boolean(branchId) &&
    canExpensesCreate &&
    organization.actor.branchAccess.some(
      (row) =>
        row.branchId === branchId && (row.accessMode === "OPERATE" || row.accessMode === "MANAGE"),
    );
  const audit = canAudit ? await listAuditLogs(db, organization.actor, { limit: 8 }) : [];

  return (
    <>
      <PageHeader
        title={organization.organization.name}
        description={t(locale, "dashboard.description")}
        actions={
          canFloor && branchId ? (
            <Link className="btn" href={`/admin/gaming/floor?branchId=${encodeURIComponent(branchId)}`}>
              {t(locale, "dashboard.openFloor")}
            </Link>
          ) : null
        }
      />

      {shouldShowBranchPicker(branches.length) ? (
        <section className="card">
          <form className="toolbar" method="get">
            <label>
              {t(locale, "dashboard.branch")}
              <select name="branchId" defaultValue={branchId ?? ""}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t(locale, "common.show")}</button>
          </form>
        </section>
      ) : null}

      {showGuidedSetup && setup && wizardLists ? (
        <GuidedSetupHost
          operationallyReady={setup.operationallyReady}
          organizationName={profile.name}
          currency={profile.defaultCurrency}
          timezone={profile.timezone}
          steps={setup.steps}
          branches={wizardLists.branches.length > 0 ? wizardLists.branches : wizardLists.manageBranches}
          areas={wizardLists.areas}
          deviceTypes={wizardLists.deviceTypes}
          devices={wizardLists.devices}
          plans={wizardLists.plans}
          assignments={wizardLists.assignments}
          staff={wizardLists.staff}
          customers={wizardLists.customers}
          products={wizardLists.products}
          roles={wizardLists.roles}
          canManageCustomers={wizardLists.canManageCustomers}
          canManageCatalog={wizardLists.canManageCatalog}
          canManageRoles={wizardLists.canManageRoles}
          currentUserId={organization.actor.userId}
        />
      ) : null}

      {canFloor ? (
        <div className="stat-grid">
          <div className="stat-card device-availability-card">
            <div className="stat-label">{t(locale, "dashboard.devices")}</div>
            <div className="device-availability-values">
              <div>
                <span>{t(locale, "dashboard.occupied")}</span>
                <strong>{occupied}</strong>
              </div>
              <div>
                <span>{t(locale, "dashboard.free")}</span>
                <strong>{available}</strong>
              </div>
            </div>
            <p className="hint">{t(locale, "dashboard.occupiedHint")}</p>
          </div>
          {canReports ? (
            <>
              <StatCard
                label={t(locale, "dashboard.billedToday")}
                value={formatMinorAmountForDisplay(billedToday, currency, locale)}
                hint={t(locale, "dashboard.billedTodayHint")}
              />
            </>
          ) : null}
          {dashboardTotals ? (
            <StatCard
              label={t(locale, "dashboard.grossHallProfit")}
              value={formatMinorAmountForDisplay(dashboardTotals.grossHallProfitMinor, currency, locale)}
              hint={t(locale, "dashboard.grossHallProfitHint")}
            />
          ) : null}
          {dashboardTotals ? (
            <StatCard
              label={t(locale, "dashboard.productSalesProfit")}
              value={formatMinorAmountForDisplay(dashboardTotals.completedProductSalesMinor, currency, locale)}
              hint={t(locale, "dashboard.productSalesProfitHint")}
            />
          ) : null}
          {canExpensesRead ? (
            <StatCard
              label={t(locale, "dashboard.expensesToday")}
              value={formatMinorAmountForDisplay(expensesToday?.totalMinor ?? 0n, currency, locale)}
              hint={t(locale, "dashboard.expensesTodayHint")}
              {...(canWithdraw && branchId
                ? {
                    action: (
                      <WithdrawalForm branchId={branchId} currency={currency} triggerClassName="btn btn-sm" />
                    ),
                  }
                : {})}
            />
          ) : null}
        </div>
      ) : (
        <section className="card">
          <p>{t(locale, "dashboard.signedIn")}</p>
        </section>
      )}

      {canReports && report && (outstanding > 0 || maintenance > 0) ? (
        <section className="card">
          <h2>{t(locale, "dashboard.needsAttention")}</h2>
          {outstanding > 0 ? (
            <p>
              {t(locale, "dashboard.unpaidBills", { count: outstanding })}{" "}
              <Link href="/admin/reports">{t(locale, "dashboard.viewReports")}</Link>
            </p>
          ) : null}
          {maintenance > 0 ? <p>{t(locale, "dashboard.devicesMaintenance", { count: maintenance })}</p> : null}
        </section>
      ) : null}

      {canAudit ? (
        <section className="card">
          <h2>{t(locale, "dashboard.recentActivity")}</h2>
          {audit.length === 0 ? (
            <p>{t(locale, "dashboard.noActivity")}</p>
          ) : (
            <ul>
              {audit.map((row) => (
                <li key={row.id}>{formatAuditLine(row, locale, timezone)}</li>
              ))}
            </ul>
          )}
          <p>
            <Link href="/admin/audit">{t(locale, "dashboard.fullActivity")}</Link>
          </p>
        </section>
      ) : null}

    </>
  );
}
