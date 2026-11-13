import Link from "next/link";
import { AuthorizationError, NotFoundError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getCustomer } from "@/modules/customers";
import { getSession, getSessionBilling, listDevices, listSessionBranches } from "@/modules/gaming";
import { listPricedProductsForBranch } from "@/modules/catalog";
import { parsePricingSnapshot } from "@/modules/gaming/billing-calculator";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { ElapsedTimer } from "@/app/admin/gaming/_components/elapsed-timer";
import { SessionAddDrinkForm } from "@/app/admin/gaming/_components/session-add-drink-form";
import {
  billingViewLabel,
  formatDateTime,
  sessionStatusLabel,
  sessionStatusTone,
} from "@/app/_lib/display";
import { formatDurationForDisplay } from "@/i18n/duration";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import type { AppLocale } from "@/i18n/locales";
import { sessionDeviceDisplayName } from "@/ui/session-device";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GamingSessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
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
  if (!permissions.includes(PERMISSIONS.gamingSessionsRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.sessions")} />;
  }

  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) {
    return <p>{t(locale, "sessions.notFound")}</p>;
  }

  let detail;
  try {
    detail = await getSession(db, organization.actor, sessionId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return <p>{t(locale, "sessions.notFound")}</p>;
    }
    if (error instanceof AuthorizationError) {
      return <p>{t(locale, "sessions.noBranchAccess")}</p>;
    }
    throw error;
  }

  const session = detail.session;
  const open = session.status === "ACTIVE" || session.status === "PAUSED";
  const canOperate =
    permissions.includes(PERMISSIONS.gamingSessionsOperate) &&
    organization.actor.branchAccess.some(
      (row) =>
        row.branchId === session.branchId && (row.accessMode === "OPERATE" || row.accessMode === "MANAGE"),
    );
  const canCancel =
    permissions.includes(PERMISSIONS.gamingSessionsCancel) &&
    organization.actor.branchAccess.some(
      (row) => row.branchId === session.branchId && row.accessMode === "MANAGE",
    );
  const branches = await listSessionBranches(db, organization.actor, "VIEW");
  const branch = branches.find((row) => row.id === session.branchId);
  const currentPause = detail.pauses.find((pause) => pause.endedAt == null);
  const billing = await getSessionBilling(db, organization.actor, sessionId);
  const canFinalize =
    canOperate && session.status === "COMPLETED" && billing.status === "UNFINALIZED" && !billing.finalized;
  const devices = await listDevices(db, organization.actor, { branchId: session.branchId, archived: "true" });
  const currentDevices = await listDevices(db, organization.actor, { branchId: session.branchId });
  const deviceNameById = new Map(
    [...devices, ...currentDevices].map((device) => [device.id, device.name]),
  );
  let customerName: string | null = null;
  if (session.customerId && permissions.includes(PERMISSIONS.customersRead)) {
    try {
      customerName = (await getCustomer(db, organization.actor, session.customerId)).displayName;
    } catch {
      customerName = t(locale, "sessions.customer");
    }
  }
  const currency = billing.result?.currency ?? session.billingCurrency ?? "SYP";
  const canSellDrinks =
    open &&
    canOperate &&
    permissions.includes(PERMISSIONS.posOrdersCreate);
  const drinkProducts = canSellDrinks
    ? (
        await listPricedProductsForBranch(db, organization.actor, session.branchId).catch(() => [])
      ).map((row) => ({
        id: row.product.id,
        name: row.product.name,
        amountMinor: row.amountMinor,
        currency: row.currency,
      }))
    : [];

  return (
    <>
      <p>
        <BackLink href="/admin/reports">{t(locale, "sessions.backToList")}</BackLink>
        {" · "}
        <Link href="/admin/gaming/floor">{t(locale, "sessions.goFloor")}</Link>
      </p>
      <PageHeader
        title={t(locale, "sessions.titleNumber", { number: session.sessionNumber })}
        description={branch?.name ? `${branch.name}` : undefined}
        actions={
          <StatusBadge tone={sessionStatusTone(session.status)}>
            {sessionStatusLabel(session.status, locale)}
          </StatusBadge>
        }
      />
      <section className="card">
        <p>
          {t(locale, "sessions.startedAt")}: {formatDateTime(session.startedAt, locale)}
        </p>
        <p>
          {t(locale, "sessions.endedAt")}: {session.endedAt ? formatDateTime(session.endedAt, locale) : "—"}
        </p>
        <p>
          {t(locale, "sessions.customer")}:{" "}
          {session.customerId ? (customerName ?? t(locale, "sessions.customer")) : t(locale, "common.guest")}
        </p>
        <p>
          {t(locale, "sessions.device")}:{" "}
          {sessionDeviceDisplayName({
            currentDeviceId: session.currentDeviceId,
            segments: detail.segments,
            deviceNameById,
            locale,
          })}
        </p>
        {open ? (
          <p>
            {t(locale, "sessions.displayTime")}:{" "}
            <ElapsedTimer
              startedAt={
                session.startedAt instanceof Date ? session.startedAt.toISOString() : String(session.startedAt)
              }
              status={session.status}
              currentPauseStartedAt={currentPause ? currentPause.startedAt.toISOString() : null}
              initialNowMs={Date.now()}
            />
          </p>
        ) : null}
        {session.cancelReason ? (
          <p>
            {t(locale, "sessions.cancelReason")}: {session.cancelReason}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>{t(locale, "sessions.bill")}</h2>
        <p>
          {billingViewLabel(billing.status, billing.finalized, locale)}
          {billing.status === "PROVISIONAL" ? ` — ${t(locale, "sessions.provisionalNote")}` : ""}
        </p>
        {billing.reason ? <p>{billing.reason}</p> : null}
        {billing.error ? <p className="error">{humanBillingError(billing.error, locale)}</p> : null}
        {billing.result ? (
          <>
            <p>
              {t(locale, "sessions.total")}:{" "}
              <strong>
                {formatMinorAmountForDisplay(billing.result.totalMinor, billing.result.currency, locale)}
              </strong>
            </p>
            <p>
              {t(locale, "sessions.playTime")}: {formatDurationForDisplay(Number(billing.result.billableSeconds), locale)}
            </p>
            <p>
              {t(locale, "sessions.billedAs")}:{" "}
              {formatDurationForDisplay(
                billing.result.segments.reduce((sum, line) => sum + Number(line.billedDurationSeconds), 0),
                locale,
              )}
            </p>
            <p>
              {t(locale, "sessions.pausedUnpaid")}:{" "}
              {formatDurationForDisplay(Number(billing.result.pausedNonBillableSeconds), locale)}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "sessions.device")}</th>
                    <th>{t(locale, "sessions.price")}</th>
                    <th>{t(locale, "sessions.playTime")}</th>
                    <th>{t(locale, "sessions.billedAs")}</th>
                    <th>{t(locale, "sessions.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.result.segments.map((line) => (
                    <tr key={line.segmentId}>
                      <td>{deviceNameById.get(line.deviceId) ?? t(locale, "sessions.device")}</td>
                      <td>{line.planName}</td>
                      <td>{formatDurationForDisplay(Number(line.billableSeconds), locale)}</td>
                      <td>{formatDurationForDisplay(Number(line.billedDurationSeconds), locale)}</td>
                      <td>{formatMinorAmountForDisplay(line.amountMinor, line.currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>{t(locale, "sessions.noBreakdown")}</p>
        )}
        {canFinalize ? (
          <ActionButton
            action={`/api/gaming/sessions/${session.id}/billing/finalize`}
            method="POST"
            label={t(locale, "sessions.finalize")}
            confirmText={t(locale, "sessions.finalizeConfirm")}
          />
        ) : null}
      </section>

      {session.status === "COMPLETED" ? (
        <section className="card">
          <h2>{t(locale, "sessions.checkout")}</h2>
          <p>{t(locale, "sessions.checkoutHint")}</p>
          <p>
            <Link className="btn" href={`/admin/gaming/sessions/${session.id}/checkout`}>
              {t(locale, "sessions.openCheckout")}
            </Link>
          </p>
        </section>
      ) : null}

      {open && canOperate ? (
        <section className="card">
          <h2>{t(locale, "sessions.controls")}</h2>
          {session.status === "ACTIVE" ? (
            <ActionButton
              action={`/api/gaming/sessions/${session.id}/pause`}
              method="POST"
              label={t(locale, "floor.pause")}
            />
          ) : (
            <ActionButton
              action={`/api/gaming/sessions/${session.id}/resume`}
              method="POST"
              label={t(locale, "floor.resume")}
            />
          )}
          <ActionButton
            action={`/api/gaming/sessions/${session.id}/end`}
            method="POST"
            label={t(locale, "floor.end")}
            confirmText={t(locale, "floor.endConfirm")}
          />
        </section>
      ) : null}

      {canSellDrinks ? (
        <section className="card">
          <h2>{t(locale, "catalog.addDrink")}</h2>
          <SessionAddDrinkForm sessionId={session.id} products={drinkProducts} />
        </section>
      ) : null}

      {open && canCancel ? (
        <section className="card">
          <h2>{t(locale, "sessions.cancelHeading")}</h2>
          <p>{t(locale, "sessions.cancelHint")}</p>
          <ApiForm
            action={`/api/gaming/sessions/${session.id}/cancel`}
            submitLabel={t(locale, "sessions.cancelSubmit")}
            fields={[{ name: "reason", label: t(locale, "sessions.reason"), type: "textarea" }]}
          />
        </section>
      ) : null}

      <section className="card table-scroll">
        <h2>{t(locale, "sessions.timeSlices")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t(locale, "sessions.device")}</th>
              <th>{t(locale, "sessions.price")}</th>
              <th>{t(locale, "sessions.started")}</th>
              <th>{t(locale, "sessions.ended")}</th>
              <th>{t(locale, "sessions.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.segments.map((segment) => {
              const snapshot = safeSnapshot(segment.pricingSnapshot);
              return (
                <tr key={segment.id}>
                  <td>{deviceNameById.get(segment.deviceId) ?? t(locale, "sessions.device")}</td>
                  <td>{snapshot?.name ?? "—"}</td>
                  <td>{formatDateTime(segment.startedAt, locale)}</td>
                  <td>{segment.endedAt ? formatDateTime(segment.endedAt, locale) : t(locale, "sessions.openSegment")}</td>
                  <td>
                    {segment.computedAmountMinor == null
                      ? "—"
                      : formatMinorAmountForDisplay(
                          segment.computedAmountMinor,
                          snapshot?.currency ?? currency,
                          locale,
                        )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card table-scroll">
        <h2>{t(locale, "sessions.pauses")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t(locale, "sessions.started")}</th>
              <th>{t(locale, "sessions.ended")}</th>
              <th>{t(locale, "sessions.charged")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.pauses.length === 0 ? (
              <tr>
                <td colSpan={3}>{t(locale, "sessions.noPauses")}</td>
              </tr>
            ) : (
              detail.pauses.map((pause) => (
                <tr key={pause.id}>
                  <td>{formatDateTime(pause.startedAt, locale)}</td>
                  <td>{pause.endedAt ? formatDateTime(pause.endedAt, locale) : t(locale, "sessions.openSegment")}</td>
                  <td>{pause.isBillable ? t(locale, "common.yes") : t(locale, "common.no")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function safeSnapshot(raw: unknown) {
  try {
    return parsePricingSnapshot(raw);
  } catch {
    return null;
  }
}

function humanBillingError(message: string, locale: AppLocale): string {
  if (message.includes("PACKAGE") || message.includes("multi-segment")) {
    return t(locale, "sessions.packageMoveError");
  }
  if (message.includes("malformed") || message.includes("snapshot")) {
    return t(locale, "sessions.snapshotError");
  }
  return t(locale, "sessions.billError");
}
