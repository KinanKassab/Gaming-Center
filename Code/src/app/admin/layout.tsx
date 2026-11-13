import type { ReactNode } from "react";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { AdminShell, type AdminNavLink } from "@/app/admin/_components/admin-shell";
import { HardRedirect } from "@/app/_components/hard-redirect";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { listBranches, listUserMemberships, PERMISSIONS } from "@/modules/identity";
import { ADMIN_NAV_HREFS, hasViewBranchGrant, shouldShowAdminNavHref } from "@/ui/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const { db, viewer, organization, accessRevoked } = await getAdminPageContext();
  if (!viewer) {
    return (
      <>
        <HardRedirect href={accessRevoked ? "/access-revoked" : "/login"} />
        {children}
      </>
    );
  }
  const permissions = organization?.actor.permissions ?? [];
  const viewGrant = organization ? hasViewBranchGrant(organization.actor.branchAccess) : false;
  const visibleBranchCount =
    organization && permissions.includes(PERMISSIONS.branchesRead)
      ? (await listBranches(db, organization.actor)).filter((branch) => branch.status !== "ARCHIVED").length
      : 0;
  const canCreateFirstOrganization =
    !organization && (await listUserMemberships(db, viewer.user.id)).length === 0;
  const visibility = {
    permissions,
    hasViewBranchGrant: viewGrant,
    visibleBranchCount,
    canCreateFirstOrganization,
  };

  const catalog: Array<AdminNavLink & { href: string; show: boolean }> = [
    {
      href: ADMIN_NAV_HREFS.dashboard,
      label: t(locale, "nav.dashboard"),
      group: "primary",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.dashboard, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.floor,
      label: t(locale, "nav.floor"),
      group: "primary",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.floor, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.reports,
      label: t(locale, "nav.reports"),
      group: "primary",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.reports, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.customers,
      label: t(locale, "nav.customers"),
      group: "primary",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.customers, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.onboarding,
      label: t(locale, "nav.setupWizard"),
      group: "tools",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.onboarding, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.branches,
      label: t(locale, "nav.branches"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.branches, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.areas,
      label: t(locale, "nav.areas"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.areas, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.devices,
      label: t(locale, "nav.devices"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.devices, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.pricing,
      label: t(locale, "nav.pricing"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.pricing, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.catalog,
      label: t(locale, "nav.catalog"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.catalog, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.staff,
      label: t(locale, "nav.staff"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.staff, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.roles,
      label: t(locale, "nav.roles"),
      group: "management",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.roles, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.settings,
      label: t(locale, "nav.settings"),
      group: "tools",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.settings, visibility),
    },
    {
      href: ADMIN_NAV_HREFS.audit,
      label: t(locale, "nav.activity"),
      group: "tools",
      show: shouldShowAdminNavHref(ADMIN_NAV_HREFS.audit, visibility),
    },
  ];
  const links: AdminNavLink[] = catalog
    .filter((link) => link.show)
    .map((link) => ({ href: link.href, label: link.label, group: link.group }));

  return (
    <AdminShell
      viewerName={viewer.user.displayName}
      organizationName={organization?.organization.name ?? null}
      links={links}
    >
      {children}
    </AdminShell>
  );
}
