import { AuthorizationError, NotFoundError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getDevice, listAccessibleBranches, listAreas, listDeviceTypes } from "@/modules/gaming";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { operationalStatusLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GamingDeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
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

  const { deviceId } = await params;
  if (!UUID_PATTERN.test(deviceId)) {
    return <p>{t(locale, "devices.notFound")}</p>;
  }

  let device;
  try {
    device = await getDevice(db, organization.actor, deviceId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return <p>{t(locale, "devices.notFound")}</p>;
    }
    if (error instanceof AuthorizationError) {
      return <p>{t(locale, "devices.noBranchAccess")}</p>;
    }
    throw error;
  }

  const canManage = permissions.includes(PERMISSIONS.gamingMasterManage);
  const archived = Boolean(device.archivedAt);
  const areas = await listAreas(db, organization.actor, { branchId: device.branchId });
  const deviceTypes = await listDeviceTypes(db, organization.actor);
  const branches = await listAccessibleBranches(db, organization.actor, "VIEW");
  const branch = branches.find((row) => row.id === device.branchId);
  const area = areas.find((row) => row.id === device.areaId);
  const deviceType = deviceTypes.find((row) => row.id === device.deviceTypeId);

  return (
    <>
      <GamingNav current="/admin/gaming/devices" />
      <p>
        <BackLink href="/admin/gaming/devices">{t(locale, "devices.back")}</BackLink>
      </p>
      <PageHeader
        title={device.name}
        description={[branch?.name, area?.name, deviceType?.name].filter(Boolean).join(" · ") || undefined}
        actions={
          <StatusBadge
            tone={archived ? "neutral" : device.operationalStatus === "ENABLED" ? "success" : "warning"}
          >
            {archived ? t(locale, "common.archived") : operationalStatusLabel(device.operationalStatus, locale)}
          </StatusBadge>
        }
      />
      {device.notes ? (
        <section className="card">
          <p>{device.notes}</p>
        </section>
      ) : null}

      {canManage && !archived ? (
        <>
          <section className="card">
            <h2>{t(locale, "common.edit")}</h2>
            <ApiForm
              action={`/api/gaming/devices/${device.id}`}
              method="PATCH"
              submitLabel={t(locale, "common.save")}
              fields={[
                { name: "name", label: t(locale, "devices.name"), defaultValue: device.name },
                {
                  name: "areaId",
                  label: t(locale, "devices.area"),
                  type: "select",
                  defaultValue: device.areaId,
                  options: areas.map((row) => ({
                    value: row.id,
                    label: row.name,
                  })),
                },
                {
                  name: "deviceTypeId",
                  label: t(locale, "deviceTypes.title"),
                  type: "select",
                  defaultValue: device.deviceTypeId,
                  options: deviceTypes.map((type) => ({
                    value: type.id,
                    label: type.name,
                  })),
                },
                {
                  name: "operationalStatus",
                  label: t(locale, "devices.status"),
                  type: "select",
                  defaultValue: device.operationalStatus,
                  options: [
                    { value: "ENABLED", label: t(locale, "status.operational.ENABLED") },
                    { value: "MAINTENANCE", label: t(locale, "status.operational.MAINTENANCE") },
                    { value: "DISABLED", label: t(locale, "status.operational.DISABLED") },
                  ],
                },
                {
                  name: "notes",
                  label: t(locale, "devices.notes"),
                  type: "textarea",
                  optional: true,
                  emptyAsNull: true,
                  defaultValue: device.notes ?? "",
                },
              ]}
            />
          </section>
          <section className="card">
            <h2>{t(locale, "devices.archiveTitle")}</h2>
            <p>{t(locale, "devices.archiveBody")}</p>
            <ActionButton
              action={`/api/gaming/devices/${device.id}/archive`}
              label={t(locale, "devices.archiveAction")}
              confirmText={t(locale, "devices.archiveConfirm", { name: device.name })}
              danger
            />
          </section>
        </>
      ) : null}
    </>
  );
}
