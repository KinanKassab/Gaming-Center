import { PERMISSIONS } from "@/modules/identity";
import {
  firstSearchParam,
  listBranchIdsWithFloorDevices,
  listFloor,
  listSessionBranches,
  resolveFloorBranchId,
} from "@/modules/gaming";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { listCustomers } from "@/modules/customers";
import { loadExpenseCurrency } from "@/modules/finance";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { PageHeader, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { FloorHallHost } from "@/app/admin/gaming/_components/floor-hall-host";
import { WithdrawalForm } from "@/app/admin/_components/withdrawal-form";
import { HardRedirect } from "@/app/_components/hard-redirect";
import { FLOOR_START_NATIVE_ACTION, floorStartQueryRedirect } from "@/ui/floor-start-form-safety";
import { isPositiveHourlyRate } from "@/ui/hall-hourly-price";

export default async function GamingFloorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const { db, organization } = await getAdminPageContext();
  if (!organization) return <SelectOrganizationNotice title={t(locale, "org.chooseNoticeTitle")} body={t(locale, "org.chooseNoticeBody")} />;
  const permissions = organization.actor.permissions;
  if (!permissions.includes(PERMISSIONS.gamingSessionsRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.floor")} />;
  }

  const query = await searchParams;
  const leakedQueryRedirect = floorStartQueryRedirect(query);
  if (leakedQueryRedirect) {
    return <HardRedirect href={leakedQueryRedirect} />;
  }

  const branches = (await listSessionBranches(db, organization.actor, "VIEW")).filter(
    (branch) => branch.status !== "ARCHIVED",
  );
  const accessibleBranchIds = branches.map((branch) => branch.id);
  const branchIdsWithDevices = await listBranchIdsWithFloorDevices(
    db,
    organization.actor,
    accessibleBranchIds,
  );
  const branchId = resolveFloorBranchId({
    requestedBranchId: firstSearchParam(query.branchId),
    accessibleBranchIds,
    branchIdsWithDevices,
  });
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const areaId = firstSearchParam(query.areaId);
  const deviceTypeId = firstSearchParam(query.deviceTypeId);
  const startNativeAction = branchId
    ? `${FLOOR_START_NATIVE_ACTION}?branchId=${encodeURIComponent(branchId)}`
    : FLOOR_START_NATIVE_ACTION;
  const floorNowMs = Date.now();
  const canStart = permissions.includes(PERMISSIONS.gamingSessionsStart);
  const canOperate = permissions.includes(PERMISSIONS.gamingSessionsOperate);
  const canCancel = permissions.includes(PERMISSIONS.gamingSessionsCancel);
  const canWithdraw =
    Boolean(branchId) &&
    permissions.includes(PERMISSIONS.financeExpensesCreate) &&
    organization.actor.branchAccess.some(
      (row) =>
        row.branchId === branchId && (row.accessMode === "OPERATE" || row.accessMode === "MANAGE"),
    );
  const withdrawCurrency = canWithdraw
    ? await loadExpenseCurrency(db, organization.actor)
    : null;
  const operateBranches = new Set(
    organization.actor.branchAccess
      .filter((row) => row.accessMode === "OPERATE" || row.accessMode === "MANAGE")
      .map((row) => row.branchId),
  );
  const manageBranches = new Set(
    organization.actor.branchAccess.filter((row) => row.accessMode === "MANAGE").map((row) => row.branchId),
  );

  const allTiles = branchId ? await listFloor(db, organization.actor, { branchId }) : [];
  const areas = [...new Map(allTiles.map((tile) => [tile.area.id, tile.area])).values()];
  const deviceTypes = [
    ...new Map(allTiles.map((tile) => [tile.deviceType.id, tile.deviceType])).values(),
  ];
  const floor = allTiles.filter((tile) => {
    const onHall = Boolean(tile.session) || isPositiveHourlyRate(tile.hourlyRateMinor);
    if (!onHall) return false;
    if (areaId && tile.area.id !== areaId) return false;
    if (deviceTypeId && tile.deviceType.id !== deviceTypeId) return false;
    return true;
  });
  const customers = permissions.includes(PERMISSIONS.customersRead)
    ? await listCustomers(db, organization.actor, { status: "ACTIVE", limit: 100 })
    : [];
  const availableMoveTargets = allTiles
    .filter((tile) => tile.occupancy === "AVAILABLE")
    .map((tile) => ({ id: tile.deviceId, code: tile.code, name: tile.name }));

  const emptyTitle = selectedBranch
    ? t(locale, "floor.emptyBranch", { branch: selectedBranch.name })
    : t(locale, "floor.empty");

  return (
    <>
      <PageHeader
        title={t(locale, "floor.title")}
        description={t(locale, "floor.description")}
        actions={
          canWithdraw && branchId && withdrawCurrency ? (
            <WithdrawalForm branchId={branchId} currency={withdrawCurrency} />
          ) : null
        }
      />

      {branches.length === 0 ? (
        <p>{t(locale, "floor.noBranches")}</p>
      ) : (
        <FloorHallHost
          filterFields={
            <>
              <BranchSelectField
                branches={branches}
                label={t(locale, "floor.branch")}
                name="branchId"
                defaultValue={branchId ?? ""}
                includeWhenSingle="omit"
              />
              {areas.length > 1 ? (
                <label>
                  {t(locale, "floor.area")}
                  <select name="areaId" defaultValue={areaId ?? ""}>
                    <option value="">{t(locale, "floor.allAreas")}</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                {t(locale, "floor.deviceType")}
                <select name="deviceTypeId" defaultValue={deviceTypeId ?? ""}>
                  <option value="">{t(locale, "floor.allTypes")}</option>
                  {deviceTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
          filterSubmitLabel={t(locale, "common.filter")}
          searchLabel={t(locale, "common.search")}
          searchPlaceholder={t(locale, "floor.searchPlaceholder")}
          emptyTitle={emptyTitle}
          searchEmptyTitle={t(locale, "floor.searchEmpty")}
          tiles={floor}
          floorNowMs={floorNowMs}
          canStart={Boolean(canStart && branchId && operateBranches.has(branchId))}
          canOperate={Boolean(canOperate && branchId && operateBranches.has(branchId))}
          canCancel={Boolean(canCancel && branchId && manageBranches.has(branchId))}
          startNativeAction={startNativeAction}
          customers={customers.map((customer) => ({
            id: customer.id,
            displayName: customer.displayName,
          }))}
          moveTargets={availableMoveTargets}
          locale={locale}
        />
      )}
    </>
  );
}
