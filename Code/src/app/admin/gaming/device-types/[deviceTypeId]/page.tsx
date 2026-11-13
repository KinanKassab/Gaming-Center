import { NotFoundError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getDeviceType } from "@/modules/gaming";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { recordLifecycleLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GamingDeviceTypeDetailPage({
  params,
}: {
  params: Promise<{ deviceTypeId: string }>;
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
  if (!organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.deviceTypes")} />;
  }

  const { deviceTypeId } = await params;
  if (!UUID_PATTERN.test(deviceTypeId)) {
    return <p>{t(locale, "deviceTypes.notFound")}</p>;
  }

  let deviceType;
  try {
    deviceType = await getDeviceType(db, organization.actor, deviceTypeId);
  } catch (error) {
    if (error instanceof NotFoundError) return <p>{t(locale, "deviceTypes.notFound")}</p>;
    throw error;
  }

  const canManage = organization.actor.permissions.includes(PERMISSIONS.gamingMasterManage);
  const archived = deviceType.status === "ARCHIVED";

  return (
    <>
      <GamingNav current="/admin/gaming/device-types" />
      <p>
        <BackLink href="/admin/gaming/device-types">{t(locale, "deviceTypes.back")}</BackLink>
      </p>
      <PageHeader
        title={deviceType.name}
        description={deviceType.category ?? undefined}
        actions={
          <StatusBadge tone={archived ? "neutral" : "success"}>{recordLifecycleLabel(archived ? "ARCHIVED" : "ACTIVE", locale)}</StatusBadge>
        }
      />
      {canManage && !archived ? (
        <>
          <section className="card">
            <h2>{t(locale, "common.edit")}</h2>
            <ApiForm
              action={`/api/gaming/device-types/${deviceType.id}`}
              method="PATCH"
              submitLabel={t(locale, "common.save")}
              fields={[
                { name: "name", label: t(locale, "deviceTypes.name"), defaultValue: deviceType.name },
                {
                  name: "category",
                  label: t(locale, "deviceTypes.category"),
                  optional: true,
                  emptyAsNull: true,
                  defaultValue: deviceType.category ?? "",
                },
              ]}
            />
          </section>
          <section className="card">
            <h2>{t(locale, "deviceTypes.archiveTitle")}</h2>
            <p>{t(locale, "deviceTypes.archiveBody")}</p>
            <ActionButton
              action={`/api/gaming/device-types/${deviceType.id}/archive`}
              label={t(locale, "deviceTypes.archiveAction")}
              confirmText={t(locale, "deviceTypes.archiveConfirm", { name: deviceType.name })}
              danger
            />
          </section>
        </>
      ) : null}
    </>
  );
}
