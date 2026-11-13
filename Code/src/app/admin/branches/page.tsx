import { listBranches, PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { PageHeader, EmptyState, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { branchStatusLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { BranchRenameForm } from "@/app/admin/branches/branch-rename-form";

export default async function BranchesPage() {
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
  if (!permissions.includes(PERMISSIONS.branchesRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.branches")} />;
  }

  const branches = await listBranches(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.branchesManage);

  return (
    <>
      <PageHeader title={t(locale, "branches.title")} description={t(locale, "branches.description")} />
      <section className="card">
        {branches.length === 0 ? (
          <EmptyState title={t(locale, "branches.empty")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
              <thead>
                <tr>
                  <th>{t(locale, "branches.name")}</th>
                  <th>{t(locale, "branches.status")}</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id}>
                    <td>{branch.name}</td>
                    <td>
                      <StatusBadge tone={branch.status === "ACTIVE" ? "success" : "neutral"}>
                        {branchStatusLabel(branch.status, locale)}
                      </StatusBadge>
                    </td>
                    {canManage ? (
                      <td>
                        {branch.status !== "ARCHIVED" ? (
                          <>
                            <ActionButton
                              action={`/api/branches/${branch.id}`}
                              method="PATCH"
                              body={{ status: branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }}
                              label={branch.status === "ACTIVE" ? t(locale, "common.close") : t(locale, "common.open")}
                            />{" "}
                            <ActionButton
                              action={`/api/branches/${branch.id}/archive`}
                              label={t(locale, "common.archive")}
                              danger
                              confirmText={t(locale, "branches.archiveConfirm", { name: branch.name })}
                            />
                            <BranchRenameForm branchId={branch.id} name={branch.name} />
                          </>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="record-cards">
              {branches.map((branch) => (
                <article key={branch.id} className="record-card">
                  <h2>{branch.name}</h2>
                  <p>
                    <StatusBadge tone={branch.status === "ACTIVE" ? "success" : "neutral"}>
                      {branchStatusLabel(branch.status, locale)}
                    </StatusBadge>
                  </p>
                  {canManage && branch.status !== "ARCHIVED" ? (
                    <p>
                      <ActionButton
                        action={`/api/branches/${branch.id}`}
                        method="PATCH"
                        body={{ status: branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }}
                        label={branch.status === "ACTIVE" ? t(locale, "common.close") : t(locale, "common.open")}
                      />{" "}
                      <ActionButton
                        action={`/api/branches/${branch.id}/archive`}
                        label={t(locale, "common.archive")}
                        danger
                        confirmText={t(locale, "branches.archiveConfirm", { name: branch.name })}
                      />
                      <BranchRenameForm branchId={branch.id} name={branch.name} />
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {canManage ? (
        <section className="card">
          <h2>{t(locale, "branches.addTitle")}</h2>
          <ApiForm
            action="/api/branches"
            submitLabel={t(locale, "branches.create")}
            fields={[
              { name: "name", label: t(locale, "branches.name"), placeholder: t(locale, "onboarding.branchPlaceholder") },
              { name: "addressText", label: t(locale, "branches.address"), optional: true },
              { name: "phone", label: t(locale, "branches.phone"), optional: true },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
