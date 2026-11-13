import Link from "next/link";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { formatDateTime, sessionStatusLabel, sessionStatusTone } from "@/app/_lib/display";
import { EmptyState, StatusBadge } from "@/app/_components/page-ui";
import { t } from "@/i18n/t";
import type { AppLocale } from "@/i18n/locales";
import type { SessionJson } from "@/modules/gaming";
import { reportsPageHref } from "@/ui/report-range";

export function SessionRecords(props: {
  locale: AppLocale;
  sessions: SessionJson[];
  deviceNameById: Map<string, string>;
  customerNameById: Map<string, string>;
  page: number;
  limit: number;
  query: {
    range?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    branchId?: string | undefined;
    status?: string | undefined;
  };
}) {
  const { locale, sessions, page, limit, query } = props;
  if (sessions.length === 0) {
    return <EmptyState title={t(locale, "sessions.empty")} body={t(locale, "sessions.emptyBody")} />;
  }

  return (
    <>
      <div className="table-scroll desktop-table">
        <table>
          <thead>
            <tr>
              <th>{t(locale, "sessions.number")}</th>
              <th>{t(locale, "sessions.status")}</th>
              <th>{t(locale, "sessions.started")}</th>
              <th>{t(locale, "sessions.ended")}</th>
              <th>{t(locale, "sessions.device")}</th>
              <th>{t(locale, "sessions.customer")}</th>
              <th>{t(locale, "sessions.billed")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <Link href={`/admin/gaming/sessions/${session.id}`}>#{session.sessionNumber}</Link>
                </td>
                <td>
                  <StatusBadge tone={sessionStatusTone(session.status)}>
                    {sessionStatusLabel(session.status, locale)}
                  </StatusBadge>
                </td>
                <td>{formatDateTime(session.startedAt, locale)}</td>
                <td>{session.endedAt ? formatDateTime(session.endedAt, locale) : "—"}</td>
                <td>
                  {session.currentDeviceId
                    ? (props.deviceNameById.get(session.currentDeviceId) ?? t(locale, "sessions.device"))
                    : "—"}
                </td>
                <td>
                  {session.customerId
                    ? (props.customerNameById.get(session.customerId) ?? t(locale, "sessions.customer"))
                    : t(locale, "common.guest")}
                </td>
                <td>
                  {session.gamingTotalMinor == null
                    ? "—"
                    : formatMinorAmountForDisplay(
                        session.gamingTotalMinor,
                        session.billingCurrency ?? "SYP",
                        locale,
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="record-cards">
        {sessions.map((session) => (
          <article key={session.id} className="record-card">
            <h2>
              <Link href={`/admin/gaming/sessions/${session.id}`}>#{session.sessionNumber}</Link>
            </h2>
            <p>
              <StatusBadge tone={sessionStatusTone(session.status)}>
                {sessionStatusLabel(session.status, locale)}
              </StatusBadge>
            </p>
            <p>{formatDateTime(session.startedAt, locale)}</p>
            <p>
              {session.gamingTotalMinor == null
                ? t(locale, "sessions.notBilled")
                : formatMinorAmountForDisplay(
                    session.gamingTotalMinor,
                    session.billingCurrency ?? "SYP",
                    locale,
                  )}
            </p>
          </article>
        ))}
      </div>
      <p>
        {t(locale, "sessions.showing", { count: sessions.length, page })}
        {page > 1 ? (
          <>
            {" "}
            <Link href={reportsPageHref({ ...query, page: page - 1 })}>{t(locale, "common.previous")}</Link>
          </>
        ) : null}
        {sessions.length === limit ? (
          <>
            {" "}
            <Link href={reportsPageHref({ ...query, page: page + 1 })}>{t(locale, "common.next")}</Link>
          </>
        ) : null}
      </p>
    </>
  );
}
