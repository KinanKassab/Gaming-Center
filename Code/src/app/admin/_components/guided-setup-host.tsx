"use client";

import { useState } from "react";
import { OnboardingWizard } from "@/app/admin/onboarding/onboarding-wizard";
import { useT } from "@/i18n/provider";
import type { SetupStepStatus } from "@/modules/onboarding/setup-types";
import { shouldAutoOpenGuidedSetup } from "@/modules/onboarding/presentation";

/** Serializable Guided Setup payload. Do not add function props or render-prop children. */
export type GuidedSetupExperienceProps = {
  operationallyReady: boolean;
  organizationName: string;
  currency: string;
  timezone: string;
  steps: SetupStepStatus[];
  branches: Array<{ id: string; code: string; name: string; status: string }>;
  areas: Array<{ id: string; branchId: string; name: string }>;
  deviceTypes: Array<{ id: string; name: string }>;
  devices: Array<{ id: string; branchId: string; deviceTypeId: string; name: string }>;
  plans: Array<{
    id: string;
    name: string;
    status: string;
    pricingModel: string;
    currency: string;
    rateMinor: string | null;
    billingUnitSeconds: number | null;
    roundingMode: string;
    timeBillingMode: string;
    packagePriceMinor: string | null;
    packageDurationSeconds: number | null;
  }>;
  assignments: Array<{
    id: string;
    pricingPlanId: string;
    scopeType: string;
    scopeId: string;
    status: string;
  }>;
  staff: Array<{
    membershipId: string;
    userId: string;
    displayName: string;
    email: string | null;
    status: string;
    joinedAt: string | null;
    roles: Array<{ roleId: string; code: string; name: string; status: string }>;
  }>;
  customers: Array<{ id: string; displayName: string; phone: string | null }>;
  products: Array<{ id: string; name: string; status: string }>;
  roles: Array<{ roleId: string; code: string; name: string; status: string }>;
  canManageCustomers: boolean;
  canManageCatalog: boolean;
  canManageRoles: boolean;
  currentUserId: string;
};

export function GuidedSetupHost(props: GuidedSetupExperienceProps) {
  const t = useT();
  const [open, setOpen] = useState(() =>
    shouldAutoOpenGuidedSetup({ completed: false, operationallyReady: props.operationallyReady }),
  );

  function defer() {
    setOpen(false);
  }

  return (
    <>
      {!open ? (
        <section className="card">
          <div className="page-header">
            <div>
              <h2>{props.operationallyReady ? t("onboarding.continueReadyTitle") : t("onboarding.continueTitle")}</h2>
              <p>{props.operationallyReady ? t("onboarding.continueReadyBody") : t("onboarding.continueBody")}</p>
            </div>
            <div className="page-header-actions">
              <button type="button" onClick={() => setOpen(true)}>
                {t("onboarding.continueSetup")}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="setup-dialog-backdrop" role="presentation">
          <div
            className="setup-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("onboarding.pageTitle")}
          >
            <OnboardingWizard
              organizationName={props.organizationName}
              currency={props.currency}
              timezone={props.timezone}
              steps={props.steps}
              operationallyReady={props.operationallyReady}
              branches={props.branches}
              areas={props.areas}
              deviceTypes={props.deviceTypes}
              devices={props.devices}
              plans={props.plans}
              assignments={props.assignments}
              staff={props.staff}
              customers={props.customers}
              products={props.products}
              roles={props.roles}
              canManageCustomers={props.canManageCustomers}
              canManageCatalog={props.canManageCatalog}
              canManageRoles={props.canManageRoles}
              currentUserId={props.currentUserId}
              embedded
              onDefer={defer}
            />
          </div>
        </div>
      )}
    </>
  );
}
