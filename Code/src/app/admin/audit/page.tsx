import { listAuditLogs, PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { PageHeader, EmptyState, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { formatAuditDetail, formatAuditLine, formatDateTime, humanAuditAction } from "@/app/_lib/display";
import { requireIanaTimeZone } from "@/core/time";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function AuditPage() {
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
  if (!organization.actor.permissions.includes(PERMISSIONS.auditRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.activity")} />;
  }

  const profile = await getOrganizationProfile(db, organization.actor);
  const timezone = requireIanaTimeZone(profile.timezone);
  const logs = await listAuditLogs(db, organization.actor, { limit: 200 });

  return (
    <>
      <PageHeader title={t(locale, "audit.title")} description={t(locale, "audit.description")} />
      <section className="card">
        {logs.length === 0 ? (
          <EmptyState title={t(locale, "audit.empty")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "audit.when")}</th>
                    <th>{t(locale, "audit.what")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const detail = formatAuditDetail(log, locale);
                    return (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.occurredAt, locale, timezone)}</td>
                        <td>
                          {humanAuditAction(log.action, locale)}
                          {detail ? ` · ${detail}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="record-cards">
              {logs.map((log) => (
                <article key={log.id} className="record-card">
                  <h2>{formatAuditLine(log, locale, timezone)}</h2>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
