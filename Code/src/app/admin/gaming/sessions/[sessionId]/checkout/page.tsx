import { AuthorizationError, NotFoundError } from "@/core/errors";
import Link from "next/link";
import { PERMISSIONS } from "@/modules/identity";
import { getCustomer } from "@/modules/customers";
import { getSession, listSessionBranches } from "@/modules/gaming";
import { getSessionCheckout } from "@/modules/finance";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { CheckoutSalesCard } from "@/app/admin/gaming/_components/checkout-sales-card";
import { CheckoutPaymentHistory } from "@/app/admin/gaming/_components/checkout-history";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { formatDateTime, settlementLabel } from "@/app/_lib/display";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { paymentMethodLabel } from "@/i18n/payment-method";
import { displayCheckoutReason } from "@/i18n/api-error";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { guestPayNoticeKind } from "@/ui/guest-checkout-notice";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GamingSessionCheckoutPage({
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
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.checkout")} />;
  }

  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) {
    return <p>{t(locale, "checkout.notFound")}</p>;
  }

  let detail;
  try {
    detail = await getSession(db, organization.actor, sessionId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return <p>{t(locale, "checkout.notFound")}</p>;
    }
    if (error instanceof AuthorizationError) {
      return <p>{t(locale, "checkout.noBranchAccess")}</p>;
    }
    throw error;
  }

  const checkout = await getSessionCheckout(db, organization.actor, sessionId);
  const session = detail.session;
  const canPay =
    checkout.eligible &&
    checkout.settlementStatus !== "PAID" &&
    permissions.includes(PERMISSIONS.financePaymentsCreate) &&
    organization.actor.branchAccess.some(
      (row) =>
        row.branchId === session.branchId && (row.accessMode === "OPERATE" || row.accessMode === "MANAGE"),
    );
  const guestNotice = guestPayNoticeKind({
    guestMustPayInFull: checkout.guestMustPayInFull,
    settlementStatus: checkout.settlementStatus,
  });
  const branches = await listSessionBranches(db, organization.actor, "VIEW");
  const branch = branches.find((row) => row.id === session.branchId);
  const currency = checkout.currency ?? session.billingCurrency ?? "SYP";
  let customerName: string | null = null;
  if (session.customerId && permissions.includes(PERMISSIONS.customersRead)) {
    try {
      customerName = (await getCustomer(db, organization.actor, session.customerId)).displayName;
    } catch {
      customerName = t(locale, "sessions.customer");
    }
  }
  const customerLabel = session.customerId
    ? (customerName ?? t(locale, "sessions.customer"))
    : t(locale, "common.guest");

  return (
    <>
      <nav className="checkout-nav" aria-label={t(locale, "checkout.backToSession")}>
        <BackLink href={`/admin/gaming/sessions/${session.id}`}>{t(locale, "checkout.backToSession")}</BackLink>
        <Link href="/admin/reports">{t(locale, "nav.reports")}</Link>
      </nav>
      <PageHeader
        title={`${t(locale, "checkout.title")} · #${session.sessionNumber}`}
        description={branch?.name}
        actions={
          <StatusBadge tone={checkout.settlementStatus === "PAID" ? "success" : "warning"}>
            {settlementLabel(checkout.settlementStatus, locale)}
          </StatusBadge>
        }
      />

      {checkout.reason ? <p>{displayCheckoutReason(checkout.reason, locale)}</p> : null}
      {guestNotice === "must_pay" ? <p>{t(locale, "checkout.guestMustPay")}</p> : null}
      {guestNotice === "paid" ? <p>{t(locale, "checkout.guestPaid")}</p> : null}

      {checkout.eligible && checkout.currency && checkout.remainingMinor != null && checkout.appliedMinor != null ? (
        <CheckoutSalesCard
          sessionId={session.id}
          customerLabel={customerLabel}
          playingStartedAt={checkout.playingStartedAt}
          playingEndedAt={checkout.playingEndedAt}
          play={checkout.play}
          drinks={checkout.drinks}
          appliedMinor={checkout.appliedMinor}
          remainingMinor={checkout.remainingMinor}
          currency={checkout.currency}
          methods={checkout.methods}
          canPay={canPay}
          guestMustPayInFull={checkout.guestMustPayInFull}
          frozenHint={t(locale, "checkout.frozenHint")}
        />
      ) : (
        <section className="card">
          <p>
            {t(locale, "checkout.playBill")}:{" "}
            {checkout.billTotalMinor == null
              ? "—"
              : formatMinorAmountForDisplay(checkout.billTotalMinor, currency, locale)}
          </p>
        </section>
      )}

      {!canPay && checkout.eligible && checkout.settlementStatus !== "PAID" ? (
        <section className="card">
          <p>{t(locale, "checkout.viewOnly")}</p>
        </section>
      ) : null}

      <section className="card">
        <h2>{t(locale, "checkout.history")}</h2>
        <CheckoutPaymentHistory
          emptyLabel={t(locale, "checkout.emptyHistory")}
          columns={{
            received: t(locale, "checkout.received"),
            method: t(locale, "checkout.method"),
            amount: t(locale, "checkout.amount"),
            status: t(locale, "common.status"),
          }}
          rows={checkout.payments.map((payment) => ({
            id: payment.id,
            received: formatDateTime(payment.receivedAt, locale),
            method: paymentMethodLabel(payment.paymentMethodCode, locale, payment.paymentMethodName),
            amount: formatMinorAmountForDisplay(payment.amountMinor, payment.currency, locale),
            status: payment.status === "COMPLETED" ? t(locale, "checkout.recorded") : payment.status,
          }))}
        />
      </section>
    </>
  );
}
