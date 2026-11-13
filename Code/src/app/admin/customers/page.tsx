import Link from "next/link";
import { listBranches, PERMISSIONS } from "@/modules/identity";
import { CUSTOMER_PAGE_SIZE, MAX_CUSTOMER_OFFSET, listCustomerPage } from "@/modules/customers";
import { organizationCurrency } from "@/modules/finance";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { CustomerCreateForm } from "@/app/admin/_components/customer-create-form";
import { PageHeader, EmptyState, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { customerStatusLabel } from "@/app/_lib/display";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { customerPageHref } from "@/ui/customer-pagination";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
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

  const query = await searchParams;
  const status =
    query.status === "ACTIVE" || query.status === "BLOCKED" || query.status === "ARCHIVED"
      ? query.status
      : undefined;
  const requestedPage = /^\d+$/.test(query.page ?? "") ? Number(query.page) : 1;
  const maxPage = Math.floor(MAX_CUSTOMER_OFFSET / CUSTOMER_PAGE_SIZE) + 1;
  const page = Number.isSafeInteger(requestedPage)
    ? Math.max(1, Math.min(requestedPage, maxPage))
    : 1;
  const customerPage = await listCustomerPage(db, organization.actor, {
    q: query.q,
    status,
    limit: CUSTOMER_PAGE_SIZE,
    offset: (page - 1) * CUSTOMER_PAGE_SIZE,
  });
  const customers = customerPage.customers;
  const hasNextPage = customerPage.hasMore && page < maxPage;
  const canManage = permissions.includes(PERMISSIONS.customersManage);
  const currency = canManage ? await organizationCurrency(db, organization.actor) : "";
  const grantedBranchIds = new Set(organization.actor.branchAccess.map((row) => row.branchId));
  const branches = permissions.includes(PERMISSIONS.branchesRead)
    ? (await listBranches(db, organization.actor)).filter(
        (branch) => branch.status !== "ARCHIVED" && grantedBranchIds.has(branch.id),
      )
    : [];

  return (
    <>
      <PageHeader title={t(locale, "customers.title")} description={t(locale, "customers.description")} />

      <section className="card">
        <form className="toolbar" method="get">
          <label>
            {t(locale, "common.search")}
            <input name="q" defaultValue={query.q ?? ""} placeholder={t(locale, "customers.searchPlaceholder")} />
          </label>
          <label>
            {t(locale, "common.status")}
            <select name="status" defaultValue={status ?? ""}>
              <option value="">{t(locale, "customers.statusAll")}</option>
              <option value="ACTIVE">{customerStatusLabel("ACTIVE", locale)}</option>
              <option value="BLOCKED">{customerStatusLabel("BLOCKED", locale)}</option>
              <option value="ARCHIVED">{customerStatusLabel("ARCHIVED", locale)}</option>
            </select>
          </label>
          <button type="submit">{t(locale, "common.search")}</button>
        </form>
      </section>

      <section className="card">
        {customers.length === 0 ? (
          <EmptyState
            title={query.q || query.status ? t(locale, "customers.emptySearch") : t(locale, "customers.empty")}
          />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "customers.name")}</th>
                    <th>{t(locale, "customers.phone")}</th>
                    <th>{t(locale, "customers.email")}</th>
                    <th>{t(locale, "common.status")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.displayName}</td>
                      <td>{customer.phoneNormalized ?? t(locale, "common.dash")}</td>
                      <td>{customer.emailNormalized ?? t(locale, "common.dash")}</td>
                      <td>
                        <StatusBadge tone={customer.status === "ACTIVE" ? "success" : "warning"}>
                          {customerStatusLabel(customer.status, locale)}
                        </StatusBadge>
                      </td>
                      <td>
                        <Link href={`/admin/customers/${customer.id}`}>{t(locale, "common.view")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="record-cards">
              {customers.map((customer) => (
                <article key={customer.id} className="record-card">
                  <h2>{customer.displayName}</h2>
                  <p>{customer.phoneNormalized ?? t(locale, "customers.noPhone")}</p>
                  <Link href={`/admin/customers/${customer.id}`}>{t(locale, "common.view")}</Link>
                </article>
              ))}
            </div>
          </>
        )}
        {page > 1 || hasNextPage ? (
          <nav aria-label={t(locale, "customers.pagination")} className="pagination">
            {page > 1 ? (
              <Link href={customerPageHref(page - 1, query.q ?? "", status)}>
                {t(locale, "common.previous")}
              </Link>
            ) : null}
            <span>{t(locale, "customers.paginationPage", { page })}</span>
            {hasNextPage ? (
              <Link href={customerPageHref(page + 1, query.q ?? "", status)}>
                {t(locale, "common.next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      {canManage ? (
        <section className="card">
          <h2>{t(locale, "customers.addTitle")}</h2>
          <CustomerCreateForm
            currency={currency}
            branches={branches.map((branch) => ({ id: branch.id, code: branch.code, name: branch.name }))}
          />
        </section>
      ) : null}
    </>
  );
}
