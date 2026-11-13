import Link from "next/link";
import { PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { PageHeader, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function GamingIndexPage() {
  const locale = await getRequestLocale();
  const { organization } = await getAdminPageContext();
  if (!organization) {
    return (
      <SelectOrganizationNotice
        title={t(locale, "org.chooseNoticeTitle")}
        body={t(locale, "org.chooseNoticeBody")}
      />
    );
  }
  const permissions = organization.actor.permissions;
  if (!permissions.includes(PERMISSIONS.gamingMasterRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.floorSetup")} />;
  }

  return (
    <>
      <GamingNav current="/admin/gaming" />
      <PageHeader title={t(locale, "hub.title")} description={t(locale, "hub.description")} />
      <section className="card">
        <div className="card-grid">
          <Link className="record-card" href="/admin/gaming/areas">
            <h2>{t(locale, "nav.areas")}</h2>
            <p>{t(locale, "hub.areasBody")}</p>
          </Link>
          <Link className="record-card" href="/admin/gaming/devices">
            <h2>{t(locale, "nav.devices")}</h2>
            <p>{t(locale, "hub.devicesBody")}</p>
          </Link>
          <Link className="record-card" href="/admin/gaming/pricing">
            <h2>{t(locale, "nav.pricing")}</h2>
            <p>{t(locale, "hub.pricingBody")}</p>
          </Link>
        </div>
      </section>
    </>
  );
}
