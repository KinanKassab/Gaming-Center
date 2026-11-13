import { listBranches, listMemberships, listRoles, isPurgedStaffAccount, PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm, SelectAction } from "@/app/admin/_components/controls";
import { PageHeader, EmptyState, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { accessModeLabel, membershipStatusLabel, systemRoleLabel } from "@/app/_lib/display";
import {
  canEditStaffMembership,
  membershipHasOwnerRole,
  shouldShowStaffBranchControls,
} from "@/ui/staff-membership";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import type { AppLocale } from "@/i18n/locales";
import { StaffEditTrigger } from "@/app/admin/users/staff-edit-trigger";

export default async function UsersPage() {
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
  if (!permissions.includes(PERMISSIONS.membershipsRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.staff")} />;
  }

  const memberships = await listMemberships(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.membershipsManage);
  const roles = permissions.includes(PERMISSIONS.rolesRead) ? await listRoles(db, organization.actor) : [];
  const branches = permissions.includes(PERMISSIONS.branchesRead)
    ? await listBranches(db, organization.actor)
    : [];

  const activeRoleOptions = roles
    .filter((role) => role.status === "ACTIVE")
    .map((role) => ({
      value: role.roleId,
      label: systemRoleLabel(role.code, role.name, locale),
    }));
  const branchOptions = branches
    .filter((branch) => branch.status !== "ARCHIVED")
    .map((branch) => ({ value: branch.id, label: branch.name }));
  const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]));
  const actorMembershipId = organization.actor.membershipId;
  const showBranchColumn = memberships.some((membership) =>
    shouldShowStaffBranchControls({
      activeBranchCount: branchOptions.length,
      isOwner: membershipHasOwnerRole(membership.roles),
      grantCount: membership.branchAccess.length,
    }),
  );

  function rowShowsBranches(membership: {
    roles: Array<{ code: string }>;
    branchAccess: Array<{ branchId: string; accessMode: string }>;
  }) {
    return shouldShowStaffBranchControls({
      activeBranchCount: branchOptions.length,
      isOwner: membershipHasOwnerRole(membership.roles),
      grantCount: membership.branchAccess.length,
    });
  }

  return (
    <>
      <PageHeader title={t(locale, "users.title")} description={t(locale, "users.description")} />
      <section className="card">
        {memberships.length === 0 ? (
          <EmptyState title={t(locale, "users.empty")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "users.name")}</th>
                    <th>{t(locale, "users.email")}</th>
                    <th>{t(locale, "common.status")}</th>
                    <th>{t(locale, "users.role")}</th>
                    {showBranchColumn ? <th>{t(locale, "users.branches")}</th> : null}
                    {canManage ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((membership) => {
                    const isSelf = !canEditStaffMembership(actorMembershipId, membership.membershipId);
                    const manageRow = canManage && !isSelf;
                    return (
                      <tr key={membership.membershipId}>
                        <td>{membership.user.displayName}</td>
                        <td>{membership.user.email}</td>
                        <td>
                          <StatusBadge
                            tone={
                              membership.user.status === "DISABLED"
                                ? "danger"
                                : membership.status === "ACTIVE"
                                  ? "success"
                                  : "warning"
                            }
                          >
                            {membership.user.status === "DISABLED"
                              ? t(locale, "users.accessEnded")
                              : membershipStatusLabel(membership.status, locale)}
                          </StatusBadge>
                        </td>
                        <td>
                          <StaffRoles
                            locale={locale}
                            membership={membership}
                            canManage={manageRow}
                            allowAssign={false}
                            activeRoleOptions={activeRoleOptions}
                          />
                          {membershipHasOwnerRole(membership.roles) ? (
                            <p className="hint">{t(locale, "users.ownerManagesAll")}</p>
                          ) : null}
                        </td>
                        {showBranchColumn ? (
                          <td>
                            {rowShowsBranches(membership) ? (
                              <StaffBranches
                                locale={locale}
                                membership={membership}
                                canManage={manageRow}
                                allowAssign={false}
                                branchOptions={branchOptions}
                                branchNameById={branchNameById}
                              />
                            ) : null}
                          </td>
                        ) : null}
                        {canManage ? (
                          <td>
                            {manageRow ? (
                              <StaffManage
                                locale={locale}
                                membership={membership}
                                activeRoleOptions={activeRoleOptions}
                                branchOptions={branchOptions}
                                branchNameById={branchNameById}
                                showBranches={rowShowsBranches(membership)}
                              />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="record-cards">
              {memberships.map((membership) => {
                const isSelf = !canEditStaffMembership(actorMembershipId, membership.membershipId);
                const manageRow = canManage && !isSelf;
                const isOwner = membershipHasOwnerRole(membership.roles);
                return (
                  <article key={membership.membershipId} className="record-card staff-card">
                    <div className="staff-field">
                      <span className="staff-field-label">{t(locale, "users.name")}</span>
                      <h2>{membership.user.displayName}</h2>
                    </div>
                    <div className="staff-field">
                      <span className="staff-field-label">{t(locale, "users.email")}</span>
                      <p>{membership.user.email}</p>
                    </div>
                    <div className="staff-field">
                      <span className="staff-field-label">{t(locale, "common.status")}</span>
                      <p>
                        <StatusBadge
                          tone={
                            membership.user.status === "DISABLED"
                              ? "danger"
                              : membership.status === "ACTIVE"
                                ? "success"
                                : "warning"
                          }
                        >
                          {membership.user.status === "DISABLED"
                            ? t(locale, "users.accessEnded")
                            : membershipStatusLabel(membership.status, locale)}
                        </StatusBadge>
                      </p>
                    </div>
                    <div className="staff-field">
                      <span className="staff-field-label">{t(locale, "users.role")}</span>
                      <StaffRoles
                        locale={locale}
                        membership={membership}
                        canManage={manageRow}
                        allowAssign={false}
                        activeRoleOptions={activeRoleOptions}
                      />
                      {isOwner ? <p className="hint">{t(locale, "users.ownerManagesAll")}</p> : null}
                    </div>
                    {rowShowsBranches(membership) ? (
                      <div className="staff-field">
                        <span className="staff-field-label">{t(locale, "users.branches")}</span>
                          <StaffBranches
                            locale={locale}
                            membership={membership}
                            canManage={manageRow}
                            allowAssign={false}
                            branchOptions={branchOptions}
                            branchNameById={branchNameById}
                          />
                      </div>
                    ) : null}
                    {manageRow ? (
                      <StaffManage
                        locale={locale}
                        membership={membership}
                        activeRoleOptions={activeRoleOptions}
                        branchOptions={branchOptions}
                        branchNameById={branchNameById}
                        showBranches={rowShowsBranches(membership)}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      {canManage ? (
        <>
          <section className="card">
            <h2>{t(locale, "users.addTitle")}</h2>
            <p>{t(locale, "users.addBody")}</p>
            <ApiForm
              action="/api/memberships"
              submitLabel={t(locale, "users.create")}
              extraBody={{ mode: "create" }}
              fields={[
                { name: "displayName", label: t(locale, "users.name") },
                { name: "email", label: t(locale, "users.email"), type: "email" },
                { name: "password", label: t(locale, "users.password"), type: "password" },
              ]}
            />
          </section>
          <section className="card">
            <h2>{t(locale, "users.inviteTitle")}</h2>
            <ApiForm
              action="/api/memberships"
              submitLabel={t(locale, "users.invite")}
              extraBody={{ mode: "attach" }}
              fields={[{ name: "email", label: t(locale, "users.email"), type: "email" }]}
            />
          </section>
        </>
      ) : null}
    </>
  );
}

function StaffRoles(props: {
  locale: AppLocale;
  membership: {
    membershipId: string;
    roles: Array<{ roleId: string; code: string; name?: string }>;
  };
  canManage: boolean;
  allowAssign?: boolean;
  activeRoleOptions: Array<{ value: string; label: string }>;
}) {
  const locale = props.locale;
  return (
    <>
      {props.membership.roles.map((role) => {
        const label = systemRoleLabel(role.code, role.name ?? role.code, locale);
        return (
          <span key={role.roleId} className="tag">
            {label}
            {props.canManage ? (
              <ActionButton
                action={`/api/memberships/${props.membership.membershipId}/roles/${role.roleId}`}
                method="DELETE"
                label="×"
                confirmText={t(locale, "users.removeRoleConfirm", { name: label })}
              />
            ) : null}
          </span>
        );
      })}
      {props.canManage && props.allowAssign && props.activeRoleOptions.length > 0 ? (
        <SelectAction
          options={props.activeRoleOptions}
          actionTemplate={`/api/memberships/${props.membership.membershipId}/roles/{value}`}
          submitLabel={t(locale, "users.assign")}
        />
      ) : null}
    </>
  );
}

function StaffBranches(props: {
  locale: AppLocale;
  membership: {
    membershipId: string;
    branchAccess: Array<{ branchId: string; accessMode: string }>;
  };
  canManage: boolean;
  allowAssign?: boolean;
  branchOptions: Array<{ value: string; label: string }>;
  branchNameById: Map<string, string>;
}) {
  const locale = props.locale;
  return (
    <>
      {props.membership.branchAccess.map((access) => (
        <span key={access.branchId} className="tag">
          {props.branchNameById.get(access.branchId) ?? t(locale, "users.branchFallback")} ·{" "}
          {accessModeLabel(access.accessMode, locale)}
          {props.canManage ? (
            <ActionButton
              action={`/api/memberships/${props.membership.membershipId}/branch-access/${access.branchId}`}
              method="DELETE"
              label="×"
              confirmText={t(locale, "users.removeBranchConfirm")}
            />
          ) : null}
        </span>
      ))}
      {props.canManage && props.allowAssign && props.branchOptions.length > 0 ? (
        <>
          {(["VIEW", "OPERATE", "MANAGE"] as const).map((mode) => (
            <SelectAction
              key={mode}
              options={props.branchOptions}
              actionTemplate={`/api/memberships/${props.membership.membershipId}/branch-access/{value}`}
              body={{ accessMode: mode }}
              submitLabel={t(locale, "users.grantMode", { mode: accessModeLabel(mode, locale) })}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

function StaffManage(props: {
  locale: AppLocale;
  membership: {
    membershipId: string;
    status: string;
    user: { displayName: string; email: string | null; status: string };
    roles: Array<{ roleId: string; code: string; name?: string }>;
    branchAccess: Array<{ branchId: string; accessMode: string }>;
  };
  activeRoleOptions: Array<{ value: string; label: string }>;
  branchOptions: Array<{ value: string; label: string }>;
  branchNameById: Map<string, string>;
  showBranches: boolean;
}) {
  const locale = props.locale;
  const purged = isPurgedStaffAccount(props.membership.user);
  const ended = props.membership.user.status === "DISABLED" || props.membership.status === "SUSPENDED";

  return (
    <div className="toolbar-actions">
      {purged ? (
        <p className="hint">{t(locale, "users.removedHint")}</p>
      ) : (
        <>
          <StaffEditTrigger title={t(locale, "users.editTitle")} editLabel={t(locale, "common.edit")}>
            <p>
              {props.membership.user.displayName}
              {props.membership.user.email ? ` · ${props.membership.user.email}` : ""}
            </p>
            <div>
              <span className="staff-field-label">{t(locale, "users.role")}</span>
              <StaffRoles
                locale={locale}
                membership={props.membership}
                canManage
                allowAssign
                activeRoleOptions={props.activeRoleOptions}
              />
            </div>
            {props.showBranches ? (
              <div>
                <span className="staff-field-label">{t(locale, "users.branches")}</span>
                <StaffBranches
                  locale={locale}
                  membership={props.membership}
                  canManage
                  allowAssign
                  branchOptions={props.branchOptions}
                  branchNameById={props.branchNameById}
                />
              </div>
            ) : null}
          </StaffEditTrigger>
          {ended ? (
            <ActionButton
              action={`/api/memberships/${props.membership.membershipId}/status`}
              body={{ action: "reactivate" }}
              label={t(locale, "users.reactivate")}
            />
          ) : (
            <ActionButton
              action={`/api/memberships/${props.membership.membershipId}/status`}
              body={{ action: "revoke" }}
              label={t(locale, "users.delete")}
              danger
              confirmText={t(locale, "users.deleteConfirm", { name: props.membership.user.displayName })}
            />
          )}
        </>
      )}
    </div>
  );
}
