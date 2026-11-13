import { listProducts } from "@/modules/catalog";
import { organizationCurrency } from "@/modules/finance";
import { PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { PageHeader, AccessDenied, SelectOrganizationNotice, EmptyState } from "@/app/_components/page-ui";
import { CatalogProductCreateForm } from "@/app/admin/catalog/_components/product-create-form";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function CatalogProductsPage() {
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
  if (!permissions.includes(PERMISSIONS.posCatalogRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "catalog.title")} />;
  }
  const products = await listProducts(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.posCatalogManage);
  const currency = canManage ? await organizationCurrency(db, organization.actor) : "SYP";

  return (
    <>
      <PageHeader title={t(locale, "catalog.title")} description={t(locale, "catalog.description")} />
      <section className="card">
        {products.length === 0 ? (
          <EmptyState title={t(locale, "catalog.empty")} />
        ) : (
          <ul>
            {products.map((product) => (
              <li key={product.id}>
                {product.name} <span className="hint">({product.code})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage ? (
        <section className="card">
          <h2>{t(locale, "catalog.addTitle")}</h2>
          <CatalogProductCreateForm currency={currency} />
        </section>
      ) : null}
    </>
  );
}
