import { PERMISSIONS, getOrganizationProfile } from "@/modules/identity";
import {
  listDeviceTypes,
  listDevices,
  listPricingAssignments,
  listPricingPlans,
  serializePricingPlan,
} from "@/modules/gaming";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { ActionButton } from "@/app/admin/_components/controls";
import { GamingNav } from "@/app/admin/gaming/_components/gaming-nav";
import { DevicePricingForm } from "@/app/admin/gaming/_components/device-pricing-form";
import { PageHeader, EmptyState, StatusBadge, AccessDenied, SelectOrganizationNotice } from "@/app/_components/page-ui";
import { pricingPlanAmountLabel, recordLifecycleLabel } from "@/app/_lib/display";
import { summarizeDeviceScopedPrices } from "@/modules/gaming/pricing-device-summary";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";

export default async function GamingPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
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
  if (!permissions.includes(PERMISSIONS.gamingMasterRead)) {
    return <AccessDenied title={t(locale, "access.deniedTitle")} message={t(locale, "access.pricing")} />;
  }

  const query = await searchParams;
  const status = query.status === "ACTIVE" || query.status === "ARCHIVED" ? query.status : undefined;
  const plans = await listPricingPlans(db, organization.actor, { status, q: query.q });
  const assignments = await listPricingAssignments(db, organization.actor);
  const devices = await listDevices(db, organization.actor);
  const deviceTypes = await listDeviceTypes(db, organization.actor);
  const profile = await getOrganizationProfile(db, organization.actor);
  const canManage = permissions.includes(PERMISSIONS.gamingMasterManage);
  const devicePriceSummary = summarizeDeviceScopedPrices({
    plans: plans.map((plan) => {
      const json = serializePricingPlan(plan);
      return {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        pricingModel: plan.pricingModel,
        currency: plan.currency,
        rateMinor: json.rateMinor,
        billingUnitSeconds: plan.billingUnitSeconds,
        roundingMode: plan.roundingMode,
        timeBillingMode: plan.timeBillingMode,
        packagePriceMinor: json.packagePriceMinor,
        packageDurationSeconds: plan.packageDurationSeconds,
      };
    }),
    assignments: assignments.map((row) => ({
      pricingPlanId: row.pricingPlanId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      status: row.status,
    })),
    devices: devices.map((device) => ({ id: device.id, name: device.name })),
    deviceTypes: deviceTypes.map((type) => ({ id: type.id, name: type.name })),
  });
  const hourlyPricedTypeIds = devicePriceSummary.hourly
    .filter((row) => row.scopeType === "DEVICE_TYPE")
    .map((row) => row.deviceId);
  const pricedTypeIds = new Set(hourlyPricedTypeIds);
  const pendingTypes = deviceTypes.filter((type) => !pricedTypeIds.has(type.id));

  return (
    <>
      <GamingNav current="/admin/gaming/pricing" />
      <PageHeader
        title={t(locale, "pricing.title")}
        description={t(locale, "pricing.description")}
      />

      <section className="card">
        <form className="toolbar" method="get">
          <label>
            {t(locale, "common.status")}
            <select name="status" defaultValue={query.status ?? ""}>
              <option value="">{t(locale, "common.active")}</option>
              <option value="ACTIVE">{t(locale, "common.active")}</option>
              <option value="ARCHIVED">{t(locale, "common.archived")}</option>
            </select>
          </label>
          <label>
            {t(locale, "common.search")}
            <input name="q" defaultValue={query.q ?? ""} placeholder={t(locale, "pricing.searchPlaceholder")} />
          </label>
          <button type="submit">{t(locale, "common.filter")}</button>
        </form>
      </section>

      <section className="card">
        {pendingTypes.length > 0 ? (
          <div className="pricing-pending">
            <p className="pricing-pending-label">{t(locale, "pricing.pendingTypes")}</p>
            <ul className="pricing-pending-list">
              {pendingTypes.map((type) => (
                <li key={type.id}>
                  <StatusBadge tone="warning">{type.name}</StatusBadge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {plans.length === 0 ? (
          <EmptyState title={t(locale, "pricing.empty")} />
        ) : (
          <>
            <div className="table-scroll desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(locale, "pricing.planName")}</th>
                    <th>{t(locale, "pricing.price")}</th>
                    <th>{t(locale, "common.status")}</th>
                    {canManage ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const json = serializePricingPlan(plan);
                    const amount = pricingPlanAmountLabel(
                      {
                        pricingModel: plan.pricingModel,
                        currency: plan.currency,
                        rateMinor: json.rateMinor,
                        billingUnitSeconds: plan.billingUnitSeconds,
                        roundingMode: plan.roundingMode,
                        timeBillingMode: plan.timeBillingMode,
                        packagePriceMinor: json.packagePriceMinor,
                        packageDurationSeconds: plan.packageDurationSeconds,
                      },
                      locale,
                    );
                    return (
                      <tr key={plan.id}>
                        <td>{plan.name}</td>
                        <td>{amount}</td>
                        <td>{recordLifecycleLabel(plan.status, locale)}</td>
                        {canManage ? (
                          <td>
                            {plan.status !== "ARCHIVED" ? (
                              <ActionButton
                                action={`/api/gaming/pricing-plans/${plan.id}/archive`}
                                label={t(locale, "common.archive")}
                                confirmText={t(locale, "pricing.archiveConfirm", { name: plan.name })}
                                danger
                              />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="record-cards">
              {plans.map((plan) => {
                const json = serializePricingPlan(plan);
                const amount = pricingPlanAmountLabel(
                  {
                    pricingModel: plan.pricingModel,
                    currency: plan.currency,
                    rateMinor: json.rateMinor,
                    billingUnitSeconds: plan.billingUnitSeconds,
                    roundingMode: plan.roundingMode,
                    timeBillingMode: plan.timeBillingMode,
                    packagePriceMinor: json.packagePriceMinor,
                    packageDurationSeconds: plan.packageDurationSeconds,
                  },
                  locale,
                );
                return (
                  <article key={plan.id} className="record-card">
                    <h2>{plan.name}</h2>
                    <p>{amount}</p>
                    {canManage && plan.status !== "ARCHIVED" ? (
                      <ActionButton
                        action={`/api/gaming/pricing-plans/${plan.id}/archive`}
                        label={t(locale, "common.archive")}
                        confirmText={t(locale, "pricing.archiveConfirm", { name: plan.name })}
                        danger
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      {canManage ? (
        <section className="card">
          <h2>{t(locale, "pricing.hourlyTitle")}</h2>
          <DevicePricingForm
            currency={profile.defaultCurrency}
            deviceTypes={deviceTypes.map((type) => ({ id: type.id, name: type.name }))}
            hourlyPricedTypeIds={hourlyPricedTypeIds}
          />
        </section>
      ) : null}
    </>
  );
}
