import { NotFoundError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getCustomer } from "@/modules/customers";
import { getCustomerStatement, organizationCurrency } from "@/modules/finance";
import { CustomerStatementTable } from "@/app/_components/customer-statement";
import { CustomerLedgerForm } from "@/app/admin/_components/customer-ledger-form";
import { and, eq, inArray } from "drizzle-orm";
import { coreBranches } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { PageHeader, StatusBadge, AccessDenied, SelectOrganizationNotice, BackLink } from "@/app/_components/page-ui";
import { customerStatusLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
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
  if (!permissions.includes(PERMISSIONS.customersRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.customers")} />;
  }

  const { customerId } = await params;
  if (!UUID_PATTERN.test(customerId)) {
    return <p>{t(locale, "customers.notFound")}</p>;
  }

  let customer;
  try {
    customer = await getCustomer(db, organization.actor, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return <p>{t(locale, "customers.notFound")}</p>;
    }
    throw error;
  }
  const canManage = permissions.includes(PERMISSIONS.customersManage);
  const archived = customer.status === "ARCHIVED";
  const statement = await getCustomerStatement(db, organization.actor, customer.id);
  const currency = statement.currency || (await organizationCurrency(db, organization.actor));
  const canRecordPayment = permissions.includes(PERMISSIONS.financePaymentsCreate);
  const grantedBranchIds = organization.actor.branchAccess.map((row) => row.branchId);
  const branches =
    (canManage || canRecordPayment) && grantedBranchIds.length > 0
      ? await withTenant(db, { organizationId: organization.actor.organizationId, userId: organization.actor.userId }, (tx) =>
          tx
            .select({ id: coreBranches.id, name: coreBranches.name, status: coreBranches.status })
            .from(coreBranches)
            .where(and(eq(coreBranches.organizationId, organization.actor.organizationId), inArray(coreBranches.id, grantedBranchIds))),
        )
      : [];
  return (
    <>
      <p>
        <BackLink href="/admin/customers">{t(locale, "customers.back")}</BackLink>
      </p>
      <PageHeader
        title={customer.displayName}
        description={customer.notes ?? undefined}
        actions={
          <StatusBadge
            tone={customer.status === "ACTIVE" ? "success" : customer.status === "BLOCKED" ? "warning" : "neutral"}
          >
            {customerStatusLabel(customer.status, locale)}
          </StatusBadge>
        }
      />
      <section className="card">
        <p>
          {t(locale, "customers.phone")}: {customer.phoneNormalized ?? t(locale, "common.dash")}
        </p>
        <p>
          {t(locale, "customers.email")}: {customer.emailNormalized ?? t(locale, "common.dash")}
        </p>
      </section>

      <section className="card">
        <h2>{t(locale, "customers.statementTitle")}</h2>
        <p>
          {t(locale, "customers.balance")}: {t(locale, `customers.position.${statement.position}`)}
        </p>
        <p>
          {t(locale, "customers.portalLink")}:{" "}
          <a href={`/customer/view/${customer.portalToken}`}>{t(locale, "customers.portalOpen")}</a>
        </p>
        <CustomerStatementTable
          locale={locale}
          currency={currency}
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
      </section>

      {!archived && (canManage || canRecordPayment) ? (
        <section className="card">
          <h2>{t(locale, "customers.ledgerAdd")}</h2>
          <CustomerLedgerForm
            customerId={customer.id}
            currency={currency}
            branches={branches.filter((branch) => branch.status !== "ARCHIVED").map((branch) => ({ id: branch.id, name: branch.name }))}
            canRecordDrink={canManage}
            canRecordPayment={canRecordPayment}
          />
        </section>
      ) : null}

      {canManage && !archived ? (
        <>
          <section className="card">
            <h2>{t(locale, "common.edit")}</h2>
            <ApiForm
              action={`/api/customers/${customer.id}`}
              method="PATCH"
              submitLabel={t(locale, "common.save")}
              fields={[
                { name: "displayName", label: t(locale, "customers.name"), defaultValue: customer.displayName },
                {
                  name: "phone",
                  label: t(locale, "customers.phone"),
                  optional: true,
                  emptyAsNull: true,
                  defaultValue: customer.phoneNormalized ?? "",
                },
                {
                  name: "email",
                  label: t(locale, "customers.email"),
                  type: "email",
                  optional: true,
                  emptyAsNull: true,
                  defaultValue: customer.emailNormalized ?? "",
                },
                {
                  name: "notes",
                  label: t(locale, "customers.notes"),
                  type: "textarea",
                  optional: true,
                  emptyAsNull: true,
                  defaultValue: customer.notes ?? "",
                },
                {
                  name: "status",
                  label: t(locale, "common.status"),
                  type: "select",
                  defaultValue: customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE",
                  options: [
                    { value: "ACTIVE", label: customerStatusLabel("ACTIVE", locale) },
                    { value: "BLOCKED", label: customerStatusLabel("BLOCKED", locale) },
                  ],
                },
              ]}
            />
          </section>
          <section className="card">
            <h2>{t(locale, "customers.archiveTitle")}</h2>
            <p>{t(locale, "customers.archiveBody")}</p>
            <ActionButton
              action={`/api/customers/${customer.id}/archive`}
              label={t(locale, "customers.archiveAction")}
              confirmText={t(locale, "customers.archiveConfirm", { name: customer.displayName })}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
