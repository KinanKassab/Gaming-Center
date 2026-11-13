import { listPermissionCatalog, listRoles, PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm, RolePermissionsEditor } from "@/app/admin/_components/controls";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { systemRoleLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function RolesPage() {
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
  if (!permissions.includes(PERMISSIONS.rolesRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.roles")} />;
  }

  const roles = await listRoles(db, organization.actor);
  const catalog = await listPermissionCatalog(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.rolesManage);

  return (
    <>
      <PageHeader title={t(locale, "roles.title")} description={t(locale, "roles.description")} />

      {roles.map((role) => (
        <section className="card" key={role.roleId}>
          <h2>
            {systemRoleLabel(role.code, role.name, locale)} {role.isSystem ? <StatusBadge>{t(locale, "roles.builtIn")}</StatusBadge> : null}{" "}
            {role.status !== "ACTIVE" ? (
              <StatusBadge>
                {role.status === "ARCHIVED" ? t(locale, "common.archived") : role.status}
              </StatusBadge>
            ) : null}
          </h2>
          {role.description ? <p>{role.description}</p> : null}
          <RolePermissionsEditor
            roleId={role.roleId}
            catalog={catalog.map((row) => ({
              code: row.code,
              module: row.module,
              name: row.name,
              description: row.description,
            }))}
            assigned={role.permissionCodes}
            disabled={!canManage || role.isSystem || role.status !== "ACTIVE"}
          />
          {canManage && !role.isSystem && role.status === "ACTIVE" ? (
            <p>
              <ActionButton
                action={`/api/roles/${role.roleId}/archive`}
                label={t(locale, "roles.archiveRole")}
                confirmText={t(locale, "roles.archiveConfirm", { name: role.name })}
              />
            </p>
          ) : null}
        </section>
      ))}

      {canManage ? (
        <section className="card">
          <h2>{t(locale, "roles.createTitle")}</h2>
          <ApiForm
            action="/api/roles"
            submitLabel={t(locale, "roles.createSubmit")}
            fields={[
              { name: "name", label: t(locale, "roles.name"), placeholder: t(locale, "roles.namePlaceholder") },
              { name: "code", label: t(locale, "roles.code"), placeholder: t(locale, "roles.codePlaceholder") },
              { name: "description", label: t(locale, "roles.descriptionOptional"), optional: true },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
