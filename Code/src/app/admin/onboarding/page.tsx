import { PERMISSIONS, getOrganizationProfile, listUserMemberships } from "@/modules/identity";
import { getGamingCenterSetupStatus } from "@/modules/onboarding/status";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { PageHeader, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { HardRedirect } from "@/app/_components/hard-redirect";
import { CreateOrganizationForm } from "@/app/admin/_components/create-organization-form";
import { OnboardingWizard } from "@/app/admin/onboarding/onboarding-wizard";
import { loadOnboardingWizardLists } from "@/app/admin/onboarding/load-wizard-data";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function OnboardingPage() {
  const locale = await getRequestLocale();
  const { db, viewer, organization } = await getAdminPageContext();
  if (!viewer) {
    return <HardRedirect href="/login" />;
  }
  if (!organization) {
    const memberships = await listUserMemberships(db, viewer.user.id);
    if (memberships.length === 0) {
      return (
        <>
          <PageHeader
            title={t(locale, "onboarding.pageTitle")}
            description={t(locale, "onboarding.firstCenterBody")}
          />
          <section className="card">
            <h2>{t(locale, "org.createTitle")}</h2>
            <CreateOrganizationForm />
          </section>
        </>
      );
    }
    return <SelectOrganizationNotice title={t(locale, "org.chooseNoticeTitle")} body={t(locale, "org.chooseNoticeBody")} />;
  }
  const canManage =
    organization.actor.permissions.includes(PERMISSIONS.branchesManage) ||
    organization.actor.permissions.includes(PERMISSIONS.gamingMasterManage);
  if (!canManage) {
    return (
      <AccessDenied
        title={t(locale, "access.deniedTitle")}
        message={t(locale, "access.onboarding")}
      />
    );
  }

  const profile = await getOrganizationProfile(db, organization.actor);
  const setup = await getGamingCenterSetupStatus(db, organization.actor);
  const lists = await loadOnboardingWizardLists(db, organization);

  return (
    <>
      <PageHeader title={t(locale, "onboarding.pageTitle")} description={t(locale, "onboarding.pageBody")} />
      <OnboardingWizard
        organizationName={profile.name}
        currency={profile.defaultCurrency}
        timezone={profile.timezone}
        steps={setup.steps}
        operationallyReady={setup.operationallyReady}
        branches={lists.branches.length > 0 ? lists.branches : lists.manageBranches}
        areas={lists.areas}
        deviceTypes={lists.deviceTypes}
        devices={lists.devices}
        plans={lists.plans}
        assignments={lists.assignments}
        staff={lists.staff}
        customers={lists.customers}
        products={lists.products}
        roles={lists.roles}
        canManageCustomers={lists.canManageCustomers}
        canManageCatalog={lists.canManageCatalog}
        canManageRoles={lists.canManageRoles}
        currentUserId={organization.actor.userId}
      />
    </>
  );
}
