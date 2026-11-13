import Link from "next/link";
import { PERMISSIONS } from "@/modules/identity";
import { listAccessibleBranches, listAreas, shouldShowBranchPicker, soleBranchId } from "@/modules/gaming";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ApiForm } from "@/app/admin/_components/controls";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, EmptyState, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { recordLifecycleLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function GamingAreasPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; status?: string; q?: string }>;
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
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.areas")} />;
  }

  const query = await searchParams;
  const status = query.status === "ACTIVE" || query.status === "ARCHIVED" ? query.status : undefined;
  const branches = (await listAccessibleBranches(db, organization.actor, "VIEW")).filter(
    (branch) => branch.status !== "ARCHIVED",
  );
  const branchId = branches.some((branch) => branch.id === query.branchId) ? query.branchId : undefined;
  const areas = await listAreas(db, organization.actor, { branchId, status, q: query.q });
  const canManage = permissions.includes(PERMISSIONS.gamingMasterManage);
  const manageBranches = (await listAccessibleBranches(db, organization.actor, "MANAGE")).filter(
    (branch) => branch.status !== "ARCHIVED",
  );
  const createBranchId = soleBranchId(manageBranches);

  return (
    <>
      <GamingNav current="/admin/gaming/areas" />
      <PageHeader title={t(locale, "areas.title")} description={t(locale, "areas.description")} />

      <section className="card">
        <form className="toolbar" method="get">
          <BranchSelectField
            branches={branches}
            label={t(locale, "areas.branch")}
            name="branchId"
            defaultValue={branchId ?? ""}
            emptyOptionLabel={t(locale, "sessions.allBranches")}
            includeWhenSingle="omit"
          />
          <label>
            {t(locale, "common.status")}
            <select name="status" defaultValue={query.status ?? ""}>
              <option value="">{t(locale, "common.active")}</option>
              <option value="ACTIVE">{t(locale, "common.active")}</option>
              <option value="ARCHIVED">{t(locale, "common.archived")}</option>
            </select>
          </label>
          <label>
            {t(locale, "common.search")}
            <input name="q" defaultValue={query.q ?? ""} placeholder={t(locale, "areas.name")} />
          </label>
          <button type="submit">{t(locale, "common.filter")}</button>
        </form>
      </section>

      <section className="card">
        {areas.length === 0 ? (
          <EmptyState title={t(locale, "areas.empty")} body={t(locale, "areas.emptyBody")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "areas.name")}</th>
                    <th>{t(locale, "areas.branch")}</th>
                    <th>{t(locale, "common.status")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {areas.map((area) => (
                    <tr key={area.id}>
                      <td>{area.name}</td>
                      <td>{branches.find((branch) => branch.id === area.branchId)?.name ?? t(locale, "common.dash")}</td>
                      <td>
                        <StatusBadge tone={area.status === "ACTIVE" ? "success" : "neutral"}>
                          {recordLifecycleLabel(area.status, locale)}
                        </StatusBadge>
                      </td>
                      <td>
                        <Link href={`/admin/gaming/areas/${area.id}`}>{t(locale, "common.view")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="record-cards">
              {areas.map((area) => (
                <article key={area.id} className="record-card">
                  <h2>{area.name}</h2>
                  <p>{branches.find((branch) => branch.id === area.branchId)?.name}</p>
                  <Link href={`/admin/gaming/areas/${area.id}`}>{t(locale, "common.view")}</Link>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {canManage && manageBranches.length > 0 ? (
        <section className="card">
          <h2>{t(locale, "areas.addTitle")}</h2>
          <ApiForm
            action="/api/gaming/areas"
            submitLabel={t(locale, "areas.create")}
            {...(createBranchId ? { extraBody: { branchId: createBranchId } } : {})}
            fields={[
              ...(shouldShowBranchPicker(manageBranches.length)
                ? [
                    {
                      name: "branchId",
                      label: t(locale, "areas.branch"),
                      type: "select" as const,
                      options: manageBranches.map((branch) => ({
                        value: branch.id,
                        label: branch.name,
                      })),
                    },
                  ]
                : []),
              { name: "name", label: t(locale, "areas.name"), placeholder: t(locale, "areas.namePlaceholder") },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
