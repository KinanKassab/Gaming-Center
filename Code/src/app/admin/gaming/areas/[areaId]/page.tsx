import { AuthorizationError, NotFoundError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getArea, listAccessibleBranches } from "@/modules/gaming";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { recordLifecycleLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GamingAreaDetailPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
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
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.areas")} />;
  }

  const { areaId } = await params;
  if (!UUID_PATTERN.test(areaId)) {
    return <p>{t(locale, "areas.notFound")}</p>;
  }

  let area;
  try {
    area = await getArea(db, organization.actor, areaId);
  } catch (error) {
    if (error instanceof NotFoundError) return <p>{t(locale, "areas.notFound")}</p>;
    if (error instanceof AuthorizationError) return <p>{t(locale, "areas.noBranchAccess")}</p>;
    throw error;
  }

  const canManage = organization.actor.permissions.includes(PERMISSIONS.gamingMasterManage);
  const branches = await listAccessibleBranches(db, organization.actor, "VIEW");
  const branch = branches.find((row) => row.id === area.branchId);
  const archived = area.status === "ARCHIVED";

  return (
    <>
      <GamingNav current="/admin/gaming/areas" />
      <p>
        <BackLink href="/admin/gaming/areas">{t(locale, "areas.back")}</BackLink>
      </p>
      <PageHeader
        title={area.name}
        description={branch?.name}
        actions={
          <StatusBadge tone={archived ? "neutral" : "success"}>{recordLifecycleLabel(archived ? "ARCHIVED" : "ACTIVE", locale)}</StatusBadge>
        }
      />
      {canManage && !archived ? (
        <>
          <section className="card">
            <h2>{t(locale, "common.edit")}</h2>
            <ApiForm
              action={`/api/gaming/areas/${area.id}`}
              method="PATCH"
              submitLabel={t(locale, "common.save")}
              fields={[{ name: "name", label: t(locale, "areas.name"), defaultValue: area.name }]}
            />
          </section>
          <section className="card">
            <h2>{t(locale, "areas.archiveTitle")}</h2>
            <p>{t(locale, "areas.archiveBody")}</p>
            <ActionButton
              action={`/api/gaming/areas/${area.id}/archive`}
              label={t(locale, "areas.archiveAction")}
              confirmText={t(locale, "areas.archiveConfirm", { name: area.name })}
              danger
            />
          </section>
        </>
      ) : null}
    </>
  );
}
