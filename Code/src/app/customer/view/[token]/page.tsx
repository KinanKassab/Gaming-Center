import type { Metadata } from "next";
import { CustomerStatementTable } from "@/app/_components/customer-statement";
import { getSafeRuntimeDb } from "@/db/client";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { getPortalStatement } from "@/modules/finance";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const locale = await getRequestLocale();
  const { token } = await params;
  if (!UUID_PATTERN.test(token)) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>{t(locale, "customers.portalTitle")}</h1>
          <p>{t(locale, "customers.notFound")}</p>
        </div>
      </div>
    );
  }

  const db = await getSafeRuntimeDb();
  const statement = await getPortalStatement(db, token);
  if (!statement) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>{t(locale, "customers.portalTitle")}</h1>
          <p>{t(locale, "customers.notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card stack">
        <h1>{statement.displayName}</h1>
        <p>{t(locale, "customers.portalReadOnly")}</p>
        <p>
          {t(locale, "customers.balance")}: {formatMinorAmountForDisplay(statement.balanceMinor, statement.currency, locale)}{" "}
          ({t(locale, `customers.position.${statement.position}`)})
        </p>
        <CustomerStatementTable
          locale={locale}
          currency={statement.currency}
          lines={statement.lines}
          kindLabels={{
            OPENING_DEBT: t(locale, "customers.kind.OPENING_DEBT"),
            OPENING_CREDIT: t(locale, "customers.kind.OPENING_CREDIT"),
            PAYMENT: t(locale, "customers.kind.PAYMENT"),
            GAMING: t(locale, "customers.kind.GAMING"),
            DRINK: t(locale, "customers.kind.DRINK"),
          }}
          labels={{
            date: t(locale, "customers.colDate"),
            description: t(locale, "customers.colDescription"),
            charge: t(locale, "customers.colCharge"),
            credit: t(locale, "customers.colCredit"),
            balance: t(locale, "customers.colBalance"),
            empty: t(locale, "customers.statementEmpty"),
          }}
        />
      </div>
    </div>
  );
}
