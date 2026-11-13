import { listBranches, PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import { listPricingPlans, shouldShowBranchPicker } from "@/modules/gaming";
import { listFeatures, listSettings } from "@/modules/settings";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { SettingValueEditor } from "@/app/admin/_components/setting-editor";
import { FieldHelp } from "@/app/_components/field-help";
import { PageHeader, AccessDenied, SelectOrganizationNotice, StatusBadge } from "@/app/_components/page-ui";
import { settingHelp, settingTitle, settingSourceLabel } from "@/app/_lib/display";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import type { AppLocale } from "@/i18n/locales";
import { shouldExposeBillingUnitSecondsSetting } from "@/ui/billing-unit-setting";
import Link from "next/link";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  const locale = await getRequestLocale();
  const { db, organization } = await getAdminPageContext();
  if (!organization) return <SelectOrganizationNotice title={t(locale, "org.chooseNoticeTitle")} body={t(locale, "org.chooseNoticeBody")} />;
  const permissions = organization.actor.permissions;
  if (!permissions.includes(PERMISSIONS.settingsRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "settings.denied")} />;
  }

  const query = await searchParams;
  const grantedBranchIds = new Set(organization.actor.branchAccess.map((row) => row.branchId));
  const branches = permissions.includes(PERMISSIONS.branchesRead)
    ? (await listBranches(db, organization.actor)).filter(
        (branch) => branch.status !== "ARCHIVED" && grantedBranchIds.has(branch.id),
      )
    : [];
  const requestedBranchId = query.branchId;
  const branchId =
    requestedBranchId && grantedBranchIds.has(requestedBranchId) ? requestedBranchId : undefined;

  const canManage = permissions.includes(PERMISSIONS.settingsManage);
  const settings = await listSettings(db, organization.actor, branchId ? { branchId } : undefined);
  const features = await listFeatures(db, organization.actor);
  const profile = permissions.includes(PERMISSIONS.organizationsManage)
    ? await getOrganizationProfile(db, organization.actor)
    : null;
  const exposeBillingUnitSeconds =
    permissions.includes(PERMISSIONS.gamingMasterRead) &&
    shouldExposeBillingUnitSecondsSetting(await listPricingPlans(db, organization.actor, { status: "ACTIVE" }));
  const visibleSettings = settings.filter(
    (setting) => setting.key !== "gaming.billing_unit_seconds" || exposeBillingUnitSeconds,
  );

  return (
    <>
      <PageHeader
        title={t(locale, "settings.title")}
        description={t(locale, "settings.description")}
      />

      <section className="card">
        <h2>{t(locale, "ui.appearance")}</h2>
        <LanguageSwitcher />
        <ThemeSwitcher />
      </section>

      {profile ? (
        <section className="card">
          <h2>{t(locale, "settings.businessProfile")}</h2>
          <ApiForm
            action="/api/organizations/current"
            method="PATCH"
            submitLabel={t(locale, "common.save")}
            fields={[
              {
                name: "name",
                label: t(locale, "settings.profileName"),
                defaultValue: profile.name,
              },
            ]}
          />
        </section>
      ) : null}

      {permissions.includes(PERMISSIONS.branchesRead) ? (
        <section className="card">
          <h2>{t(locale, "settings.locations")}</h2>
          <p className="hint">{t(locale, "settings.locationsHelp")}</p>
          <p>
            <Link href="/admin/branches">{t(locale, "settings.manageLocations")}</Link>
          </p>
        </section>
      ) : null}

      {shouldShowBranchPicker(branches.length) ? (
        <section className="card">
          <form className="toolbar" method="get">
          <label>
            {t(locale, "settings.appliesTo")}
            <select name="branchId" defaultValue={branchId ?? ""}>
              <option value="">{t(locale, "settings.wholeBusiness")}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t(locale, "common.view")}</button>
          </form>
        </section>
      ) : null}

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>{t(locale, "settings.options")}</h2>
          <p className="hint">{t(locale, "settings.optionsBody")}</p>
        </div>
        {visibleSettings.length === 0 ? (
          <p>{t(locale, "settings.noSettings")}</p>
        ) : (
          <div className="settings-option-grid">
            {visibleSettings.map((setting) => {
              const manageBranch =
                canManage &&
                Boolean(branchId) &&
                organization.actor.branchAccess.some(
                  (grant) => grant.branchId === branchId && grant.accessMode === "MANAGE",
                );
              const help = settingHelp(setting.key, locale);
              const editor =
                canManage && !branchId ? (
                  <SettingValueEditor
                    settingKey={setting.key}
                    valueType={setting.valueType}
                    currentValue={setting.organizationValue ?? setting.defaultValue}
                    savePath={`/api/settings/${setting.key}`}
                    resetPath={`/api/settings/${setting.key}`}
                    canManage
                    hasOverride={setting.source === "ORGANIZATION"}
                  />
                ) : branchId && manageBranch ? (
                  <SettingValueEditor
                    settingKey={setting.key}
                    valueType={setting.valueType}
                    currentValue={setting.branchValue ?? setting.effectiveValue}
                    savePath={`/api/settings/${setting.key}/branches/${branchId}`}
                    resetPath={`/api/settings/${setting.key}/branches/${branchId}`}
                    canManage
                    hasOverride={setting.source === "BRANCH"}
                  />
                ) : (
                  <p>{formatJson(setting.effectiveValue, locale)}</p>
                );
              return (
                <article key={setting.key} className="settings-option-card">
                  <div className="settings-option-head">
                    <h3>
                    <span className="field-label-row">
                      {settingTitle(setting.key, locale, setting.description)}
                      {help ? (
                        <FieldHelp
                          title={settingTitle(setting.key, locale, setting.description)}
                          what={help.what}
                          choose={help.choose}
                          example={help.example}
                        />
                      ) : null}
                    </span>
                    </h3>
                    <span className="settings-source">{settingSourceLabel(setting.source, locale)}</span>
                  </div>
                  {editor}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {features.length > 0 ? (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>{t(locale, "settings.optionalCapabilities")}</h2>
            <p>{t(locale, "settings.capabilitiesBody")}</p>
          </div>
          <div className="settings-capability-grid">
            {features.map((feature) => (
              <article key={feature.code} className="settings-capability-card">
                <div className="settings-capability-head">
                  <div>
                    <h3>{featureTitle(feature.code, locale, feature.description)}</h3>
                    <code>{feature.code}</code>
                  </div>
                  <StatusBadge tone={feature.enabled ? "success" : "neutral"}>
                    {feature.enabled ? t(locale, "settings.on") : t(locale, "settings.off")}
                  </StatusBadge>
                </div>
                {canManage ? (
                  <ActionButton
                    action={`/api/features/${feature.code}`}
                    method="PUT"
                    body={{ enabled: !feature.enabled }}
                    label={feature.enabled ? t(locale, "settings.turnOff") : t(locale, "settings.turnOn")}
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function formatJson(value: unknown, locale: AppLocale): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? t(locale, "common.yes") : t(locale, "common.no");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function featureTitle(code: string, locale: AppLocale, fallback: string | null): string {
  if (code === "gaming.floor") return t(locale, "settings.capabilityGamingFloor");
  if (code === "inventory.stock") return t(locale, "settings.capabilityInventory");
  if (code === "pos.sales") return t(locale, "settings.capabilityPos");
  return fallback ?? code;
}
