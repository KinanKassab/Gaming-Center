import Link from "next/link";
import { PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import {
  listAccessibleBranches,
  listAreas,
  listDeviceTypes,
  listDevices,
  listHallReadyDeviceIds,
} from "@/modules/gaming";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, EmptyState, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { DeviceCategoryCards } from "@/app/admin/gaming/_components/device-category-cards";
import { DeviceHallPriceCell } from "@/app/admin/gaming/_components/device-hall-price";
import { HallDevicesHost } from "@/app/admin/gaming/_components/hall-devices-host";
import { operationalStatusLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function GamingDevicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    branchId?: string;
    areaId?: string;
    operationalStatus?: string;
    archived?: string;
    q?: string;
  }>;
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
  if (!permissions.includes(PERMISSIONS.gamingMasterRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.devices")} />;
  }

  const query = await searchParams;
  const branches = await listAccessibleBranches(db, organization.actor, "VIEW");
  const activeBranches = branches.filter((branch) => branch.status !== "ARCHIVED");
  const branchId = activeBranches.some((branch) => branch.id === query.branchId) ? query.branchId : undefined;
  const operationalStatus =
    query.operationalStatus === "ENABLED" ||
    query.operationalStatus === "MAINTENANCE" ||
    query.operationalStatus === "DISABLED"
      ? query.operationalStatus
      : undefined;
  const archived = query.archived === "true" ? "true" : undefined;
  const devices = await listDevices(db, organization.actor, {
    branchId,
    areaId: query.areaId,
    operationalStatus,
    archived,
    q: query.q,
  });
  const hallReadyIds = await listHallReadyDeviceIds(db, organization.actor, devices);
  const profile = await getOrganizationProfile(db, organization.actor);
  const currency = profile.defaultCurrency;
  const hallDevices = await listDevices(db, organization.actor, { branchId });
  const areas = await listAreas(db, organization.actor, { branchId });
  const deviceTypes = await listDeviceTypes(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.gamingMasterManage);
  const manageBranches = (await listAccessibleBranches(db, organization.actor, "MANAGE")).filter(
    (branch) => branch.status !== "ARCHIVED",
  );
  const manageAreas = areas.filter((area) => manageBranches.some((branch) => branch.id === area.branchId));

  return (
    <>
      <GamingNav current="/admin/gaming/devices" />
      <PageHeader title={t(locale, "devices.title")} description={t(locale, "devices.description")} />

      {canManage ? (
        <HallDevicesHost
          branches={manageBranches}
          areas={manageAreas}
          deviceTypes={deviceTypes}
          devices={hallDevices}
          {...(branchId ? { preferredBranchId: branchId } : {})}
        />
      ) : null}

      <section className="card">
        <form className="toolbar" method="get">
          <BranchSelectField
            branches={activeBranches}
            label={t(locale, "devices.branch")}
            name="branchId"
            defaultValue={branchId ?? ""}
            emptyOptionLabel={t(locale, "sessions.allBranches")}
            includeWhenSingle="omit"
          />
          <label>
            {t(locale, "devices.area")}
            <select name="areaId" defaultValue={query.areaId ?? ""}>
              <option value="">{t(locale, "floor.allAreas")}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "devices.status")}
            <select name="operationalStatus" defaultValue={query.operationalStatus ?? ""}>
              <option value="">{t(locale, "devices.any")}</option>
              <option value="ENABLED">{operationalStatusLabel("ENABLED", locale)}</option>
              <option value="MAINTENANCE">{operationalStatusLabel("MAINTENANCE", locale)}</option>
              <option value="DISABLED">{operationalStatusLabel("DISABLED", locale)}</option>
            </select>
          </label>
          <label>
            {t(locale, "devices.lifecycle")}
            <select name="archived" defaultValue={query.archived ?? ""}>
              <option value="">{t(locale, "devices.current")}</option>
              <option value="true">{t(locale, "common.archived")}</option>
            </select>
          </label>
          <label>
            {t(locale, "common.search")}
            <input name="q" defaultValue={query.q ?? ""} placeholder={t(locale, "devices.searchName")} />
          </label>
          <button type="submit">{t(locale, "common.filter")}</button>
        </form>
      </section>

      <section className="card">
        {devices.length === 0 ? (
          <EmptyState title={t(locale, "devices.empty")} body={t(locale, "devices.emptyBody")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "devices.name")}</th>
                    <th>{t(locale, "devices.area")}</th>
                    <th>{t(locale, "devices.type")}</th>
                    <th>{t(locale, "devices.status")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td>{device.name}</td>
                      <td>{areas.find((area) => area.id === device.areaId)?.name ?? t(locale, "common.dash")}</td>
                      <td>
                        {deviceTypes.find((type) => type.id === device.deviceTypeId)?.name ?? t(locale, "common.dash")}
                      </td>
                      <td>
                        <DeviceHallPriceCell
                          deviceId={device.id}
                          deviceName={device.name}
                          currency={currency}
                          hallReady={hallReadyIds.has(device.id)}
                          archived={Boolean(device.archivedAt)}
                          operationalStatus={device.operationalStatus}
                          operationalLabel={operationalStatusLabel(device.operationalStatus, locale)}
                          canManage={canManage}
                        />
                      </td>
                      <td>
                        <Link href={`/admin/gaming/devices/${device.id}`}>{t(locale, "common.view")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DeviceCategoryCards
              currency={currency}
              canManage={canManage}
              viewLabel={t(locale, "common.view")}
              devices={devices.map((device) => ({
                id: device.id,
                name: device.name,
                areaName: areas.find((area) => area.id === device.areaId)?.name ?? t(locale, "common.dash"),
                typeId: device.deviceTypeId,
                typeName:
                  deviceTypes.find((type) => type.id === device.deviceTypeId)?.name ?? t(locale, "common.dash"),
                hallReady: hallReadyIds.has(device.id),
                archived: Boolean(device.archivedAt),
                operationalStatus: device.operationalStatus,
                operationalLabel: operationalStatusLabel(device.operationalStatus, locale),
              }))}
            />
          </>
        )}
      </section>
    </>
  );
}
