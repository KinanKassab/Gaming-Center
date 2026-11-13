"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { SelectAction } from "@/app/admin/_components/controls";
import { CustomerCreateForm } from "@/app/admin/_components/customer-create-form";
import { CatalogProductCreateForm } from "@/app/admin/catalog/_components/product-create-form";
import { DevicePricingForm } from "@/app/admin/gaming/_components/device-pricing-form";
import { pricingPlanAmountLabel, membershipStatusLabel, systemRoleLabel } from "@/app/_lib/display";
import { summarizeDeviceScopedPrices } from "@/modules/gaming/pricing-device-summary";
import {
  WizardDeviceTypeStep,
  type WizardDeviceTypeChanges,
  type WizardDeviceTypeDraftState,
} from "@/app/admin/onboarding/wizard-device-type-step";
import { persistDeviceTypeDraft } from "@/app/admin/onboarding/persist-device-type-draft";
import { WizardPricingReview } from "@/app/admin/onboarding/wizard-pricing-review";
import { SuccessBanner } from "@/app/_components/feedback";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { StatusChip } from "@/app/_components/status-chip";
import { useT, useLocale } from "@/i18n/provider";
import { formatDateTime } from "@/app/_lib/display";
import type { WizardStaffMember } from "@/app/admin/onboarding/wizard-staff";
import type { MessageKey } from "@/i18n/t";
import type { SetupStepStatus } from "@/modules/onboarding/setup-types";
import {
  WIZARD_STEP_IDS,
  canAdvanceWizard,
  canOpenWizardStep,
  canSkipWizardStep,
  initialWizardIndex,
  shouldAutoAdvanceWizardForm,
  wizardReviewItems,
  type WizardStepId,
} from "@/modules/onboarding/wizard-flow";

const STEP_LABEL: Record<WizardStepId, MessageKey> = {
  welcome: "onboarding.stepWelcome",
  branch: "onboarding.stepBranch",
  area: "onboarding.stepArea",
  deviceType: "onboarding.stepDeviceType",
  pricing: "onboarding.stepPricing",
  customers: "onboarding.stepCustomers",
  products: "onboarding.stepProducts",
  staff: "onboarding.stepStaff",
  roles: "onboarding.stepRoles",
  review: "onboarding.stepFinish",
};

const REVIEW_LABEL: Record<"branch" | "area" | "devices" | "pricing" | "staff", MessageKey> = {
  branch: "onboarding.statusBranch",
  area: "onboarding.statusArea",
  devices: "onboarding.statusDevice",
  pricing: "onboarding.statusPricing",
  staff: "onboarding.statusStaff",
};

export function OnboardingWizard(props: {
  organizationName: string;
  currency: string;
  timezone: string;
  steps: SetupStepStatus[];
  operationallyReady: boolean;
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
  staff: WizardStaffMember[];
  customers: Array<{ id: string; displayName: string; phone: string | null }>;
  products: Array<{ id: string; name: string; status: string }>;
  roles: Array<{ roleId: string; code: string; name: string; status: string }>;
  canManageCustomers: boolean;
  canManageCatalog: boolean;
  canManageRoles: boolean;
  currentUserId: string;
  embedded?: boolean;
  onDefer?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [index, setIndex] = useState(() => initialWizardIndex(props.steps, props.operationallyReady));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pricingReviewOpen, setPricingReviewOpen] = useState(false);
  const [deviceDraft, setDeviceDraft] = useState<WizardDeviceTypeDraftState | null>(null);
  const stepId = WIZARD_STEP_IDS[index] ?? "welcome";
  const manageBranches = props.branches.filter((branch) => branch.status !== "ARCHIVED");
  const canAdvanceFromSavedData = canAdvanceWizard(index, props.steps);
  const canAdvance =
    stepId === "deviceType" && deviceDraft
      ? deviceDraft.isValid && deviceDraft.isReady
      : canAdvanceFromSavedData;
  const canSkip = canSkipWizardStep(index, props.steps);
  const lastIndex = WIZARD_STEP_IDS.length - 1;
  const addedStaff = props.staff.filter((member) => member.userId !== props.currentUserId);
  const assignableRoles = props.roles.filter((role) => role.status === "ACTIVE" && role.code !== "OWNER");

  const devicePrices = useMemo(
    () =>
      summarizeDeviceScopedPrices({
        plans: props.plans,
        assignments: props.assignments,
        devices: props.devices,
        deviceTypes: props.deviceTypes,
      }),
    [props.assignments, props.deviceTypes, props.devices, props.plans],
  );
  const hourlyPricedTypeIds = useMemo(
    () =>
      devicePrices.hourly.filter((row) => row.scopeType === "DEVICE_TYPE").map((row) => row.deviceId),
    [devicePrices.hourly],
  );

  async function submit(path: string, body: Record<string, unknown>, method = "POST") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(path, { method, body });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result, locale));
      return { ok: false as const };
    }
    router.refresh();
    return { ok: true as const, body: result.body };
  }

  function afterCreate(ok: boolean) {
    if (!ok) return;
    if (shouldAutoAdvanceWizardForm(stepId)) {
      setIndex((value) => value + 1);
      setSuccess(null);
      return;
    }
    setSuccess(t("onboarding.savedStay"));
  }

  function goTo(target: number) {
    if (!canOpenWizardStep(target, props.steps)) {
      setError(t("onboarding.stepBlocked"));
      return;
    }
    setError(null);
    setSuccess(null);
    setPricingReviewOpen(false);
    setIndex(target);
  }

  const updateDeviceDraft = useCallback((draft: WizardDeviceTypeDraftState) => {
    setDeviceDraft(draft);
  }, []);

  async function goNext() {
    if (!canAdvanceWizard(index, props.steps)) {
      if (stepId !== "deviceType" || !deviceDraft?.isValid || !deviceDraft.isReady) {
        setError(t("onboarding.stepBlocked"));
        return;
      }
    }
    if (stepId === "deviceType" && deviceDraft?.hasChanges) {
      const saved = await saveDeviceTypeChanges(deviceDraft.changes);
      if (!saved) return;
      setSuccess(null);
      setIndex((value) => value + 1);
      return;
    }
    if (stepId === "pricing") {
      setPricingReviewOpen(true);
      return;
    }
    goTo(index + 1);
  }

  function defer() {
    if (props.onDefer) props.onDefer();
    else router.push("/admin");
  }

  async function finishToFloor() {
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/ui/guided-setup", { method: "POST", body: { action: "complete" } });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result, locale));
      return;
    }
    router.push("/admin/gaming/floor");
  }

  async function saveDeviceTypeChanges(changes: WizardDeviceTypeChanges): Promise<boolean> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const branch = manageBranches[0];
    const area = branch
      ? (props.areas.find((item) => item.branchId === branch.id) ?? props.areas[0])
      : undefined;
    const result = await persistDeviceTypeDraft({
      changes,
      ...(branch ? { branchId: branch.id } : {}),
      ...(area ? { areaId: area.id } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result.error, locale));
      router.refresh();
      return false;
    }
    setSuccess(t("onboarding.savedStay"));
    router.refresh();
    return true;
  }

  return (
    <div>
      <ol className="stepper" aria-label={t("onboarding.progress")}>
        {WIZARD_STEP_IDS.map((itemId, i) => {
          const openable = canOpenWizardStep(i, props.steps);
          const className = [i === index ? "current" : i < index ? "done" : undefined, !openable ? "blocked" : undefined]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={itemId} className={className || undefined}>
              <button
                type="button"
                disabled={!openable}
                aria-current={i === index ? "step" : undefined}
                onClick={() => goTo(i)}
              >
                {t(STEP_LABEL[itemId])}
              </button>
            </li>
          );
        })}
      </ol>

      {stepId === "welcome" ? (
        <section className="card">
          <h2>{t("onboarding.welcomeTitle", { name: props.organizationName })}</h2>
          <p>{t("onboarding.welcomeBody")}</p>
        </section>
      ) : null}

      {stepId === "branch" ? (
        <section className="card">
          <h2>{t("onboarding.branchTitle")}</h2>
          {manageBranches.length > 0 ? (
            <p>{t("onboarding.branchCurrent", { names: manageBranches.map((branch) => branch.name).join(", ") })}</p>
          ) : (
            <p>{t("onboarding.branchHint")}</p>
          )}
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const result = await submit("/api/branches", { name: String(data.get("name") ?? "") });
              afterCreate(result.ok);
            }}
          >
            <label>
              {t("onboarding.branchName")}
              <input name="name" required placeholder={t("onboarding.branchPlaceholder")} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("onboarding.saveBranch")}
            </button>
          </form>
        </section>
      ) : null}

      {stepId === "area" ? (
        <section className="card">
          <h2>{t("onboarding.areaTitle")}</h2>
          <p className="hint">{t("onboarding.multiEntryHint")}</p>
          {props.areas.length > 0 ? (
            <p>{t("onboarding.areaCurrent", { names: props.areas.map((area) => area.name).join(", ") })}</p>
          ) : null}
          {manageBranches.length === 0 ? (
            <p>{t("onboarding.areaNeedBranch")}</p>
          ) : (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const result = await submit("/api/gaming/areas", {
                  branchId: String(data.get("branchId") ?? ""),
                  name: String(data.get("name") ?? t("onboarding.areaDefault")),
                });
                afterCreate(result.ok);
              }}
            >
              <BranchSelectField
                branches={manageBranches}
                label={t("dashboard.branch")}
                name="branchId"
                required
              />
              <label>
                {t("onboarding.areaName")}
                <input name="name" required defaultValue={t("onboarding.areaDefault")} />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? t("common.saving") : t("onboarding.saveArea")}
              </button>
            </form>
          )}
        </section>
      ) : null}

      {stepId === "deviceType" ? (
        <WizardDeviceTypeStep
          deviceTypes={props.deviceTypes}
          devices={props.devices}
          canSetCounts={manageBranches.length > 0 && props.areas.length > 0}
          busy={busy}
          showSaveAction={false}
          onDraftStateChange={updateDeviceDraft}
          onSaveChanges={saveDeviceTypeChanges}
        />
      ) : null}

      {stepId === "pricing" ? (
        <section className="card">
          <h2>{t("onboarding.pricingTitle")}</h2>
          <p>{t("onboarding.pricingBody")}</p>
          <p className="hint">{t("onboarding.multiEntryHint")}</p>
          {devicePrices.hourly.length === 0 && devicePrices.offers.length === 0 ? (
            <p>{t("onboarding.pricingNone")}</p>
          ) : (
            <>
              {devicePrices.hourly.length > 0 ? (
                <div className="setup-choice-block">
                  <h3>{t("onboarding.pricingCurrentHourly")}</h3>
                  <ul className="pricing-saved-list">
                    {devicePrices.hourly.map((row) => (
                      <li key={`${row.scopeType}:${row.deviceId}`}>
                        {row.deviceName}:{" "}
                        {pricingPlanAmountLabel(
                          {
                            pricingModel: "TIME_BASED",
                            currency: row.currency,
                            rateMinor: row.rateMinor,
                            billingUnitSeconds: row.billingUnitSeconds,
                            roundingMode: row.roundingMode,
                            timeBillingMode: row.timeBillingMode,
                          },
                          locale,
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {devicePrices.offers.length > 0 ? (
                <div className="setup-choice-block">
                  <h3>{t("onboarding.pricingCurrentOffers")}</h3>
                  <ul className="pricing-saved-list">
                    {devicePrices.offers.map((row) => (
                      <li key={row.planId}>
                        {row.name}:{" "}
                        {pricingPlanAmountLabel(
                          {
                            pricingModel: "PACKAGE",
                            currency: row.currency,
                            packagePriceMinor: row.packagePriceMinor,
                            packageDurationSeconds: row.packageDurationSeconds,
                          },
                          locale,
                        )}{" "}
                        · {row.deviceNames.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          <DevicePricingForm
            currency={props.currency}
            deviceTypes={props.deviceTypes}
            hourlyPricedTypeIds={hourlyPricedTypeIds}
            onSuccess={() => setSuccess(t("onboarding.savedStay"))}
          />
        </section>
      ) : null}

      {stepId === "customers" ? (
        <section className="card">
          <h2>{t("onboarding.customersTitle")}</h2>
          <p>{t("onboarding.customersBody")}</p>
          {props.customers.length > 0 ? (
            <div className="setup-choice-block">
              <h3>{t("onboarding.customersAdded")}</h3>
              <ul className="setup-saved-list">
                {props.customers.map((customer) => (
                  <li key={customer.id}>
                    <strong>{customer.displayName}</strong>
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {props.canManageCustomers ? (
            <CustomerCreateForm branches={manageBranches} currency={props.currency} />
          ) : (
            <p className="hint">{t("onboarding.customersNoAccess")}</p>
          )}
        </section>
      ) : null}

      {stepId === "products" ? (
        <section className="card">
          <h2>{t("onboarding.productsTitle")}</h2>
          <p>{t("onboarding.productsBody")}</p>
          {props.products.length > 0 ? (
            <div className="setup-choice-block">
              <h3>{t("onboarding.productsAdded")}</h3>
              <ul className="setup-saved-list">
                {props.products
                  .filter((product) => product.status === "ACTIVE")
                  .map((product) => (
                    <li key={product.id}>{product.name}</li>
                  ))}
              </ul>
            </div>
          ) : null}
          {props.canManageCatalog ? (
            <CatalogProductCreateForm currency={props.currency} showInventoryStatus />
          ) : (
            <p className="hint">{t("onboarding.productsNoAccess")}</p>
          )}
        </section>
      ) : null}

      {stepId === "staff" ? (
        <section className="card">
          <h2>{t("onboarding.staffTitle")}</h2>
          <p>{t("onboarding.staffBody")}</p>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              const result = await submit("/api/memberships", {
                mode: "create",
                displayName: String(data.get("displayName") ?? ""),
                email: String(data.get("email") ?? ""),
                password: String(data.get("password") ?? ""),
              });
              if (result.ok) form.reset();
              afterCreate(result.ok);
            }}
          >
            <label>
              {t("onboarding.staffName")}
              <input name="displayName" required />
            </label>
            <label>
              {t("onboarding.staffEmail")}
              <input name="email" type="email" required />
            </label>
            <label>
              {t("onboarding.staffPassword")}
              <input name="password" type="password" required minLength={8} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("onboarding.addStaff")}
            </button>
          </form>
          <div className="setup-choice-block">
            <h3>{t("onboarding.staffAdded")}</h3>
            {addedStaff.length === 0 ? (
              <p className="hint">{t("onboarding.staffEmpty")}</p>
            ) : (
              <ul className="setup-saved-list">
                {addedStaff.map((member) => (
                  <li key={member.membershipId}>
                    <strong>{member.displayName}</strong>
                    {member.email ? ` · ${member.email}` : ""}
                    {" · "}
                    <StatusChip tone={member.status === "ACTIVE" ? "success" : "warning"}>
                      {membershipStatusLabel(member.status, locale)}
                    </StatusChip>
                    {member.joinedAt ? ` · ${t("onboarding.staffAddedAt", { when: formatDateTime(member.joinedAt, locale, props.timezone) })}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {stepId === "roles" ? (
        <section className="card">
          <h2>{t("onboarding.rolesTitle")}</h2>
          <p>{t("onboarding.rolesBody")}</p>
          {addedStaff.length === 0 ? (
            <p className="hint">{t("onboarding.rolesNeedStaff")}</p>
          ) : assignableRoles.length === 0 ? (
            <p className="hint">
              {t("onboarding.rolesNeedRole")} <Link href="/admin/roles">{t("onboarding.rolesManage")}</Link>
            </p>
          ) : (
            <div className="setup-role-list">
              {addedStaff.map((member) => {
                const assignedRoleIds = new Set(member.roles.map((role) => role.roleId));
                const options = assignableRoles
                  .filter((role) => !assignedRoleIds.has(role.roleId))
                  .map((role) => ({
                    value: role.roleId,
                    label: systemRoleLabel(role.code, role.name, locale),
                  }));
                return (
                  <article key={member.membershipId} className="setup-role-row">
                    <div>
                      <strong>{member.displayName}</strong>
                      <div className="setup-role-tags">
                        {member.roles.length > 0
                          ? member.roles.map((role) => (
                              <span className="tag" key={role.roleId}>
                                {systemRoleLabel(role.code, role.name, locale)}
                              </span>
                            ))
                          : <span className="hint">{t("onboarding.rolesUnassigned")}</span>}
                      </div>
                    </div>
                    {props.canManageRoles && options.length > 0 ? (
                      <SelectAction
                        options={options}
                        actionTemplate={`/api/memberships/${member.membershipId}/roles/{value}`}
                        submitLabel={t("onboarding.rolesAssign")}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          <p>
            <Link href="/admin/roles">{t("onboarding.rolesManage")}</Link>
          </p>
        </section>
      ) : null}

      {stepId === "review" ? (
        <section className="card">
          <h2>{props.operationallyReady ? t("onboarding.reviewReady") : t("onboarding.reviewAlmost")}</h2>
          <ul>
            {wizardReviewItems(props.steps).map((item) => (
              <li key={item.id}>
                {t(REVIEW_LABEL[item.id])}:{" "}
                {item.done ? t("common.ready") : item.optional ? t("common.optional") : t("common.stillNeeded")}
              </li>
            ))}
          </ul>
          {props.operationallyReady ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void finishToFloor()}>
              {busy ? t("common.working") : t("onboarding.goFloor")}
            </button>
          ) : (
            <p>{t("onboarding.reviewRemain")}</p>
          )}
        </section>
      ) : null}

      {pricingReviewOpen ? (
        <WizardPricingReview
          hourly={devicePrices.hourly}
          offers={devicePrices.offers}
          onStay={() => setPricingReviewOpen(false)}
          onContinue={() => {
            setPricingReviewOpen(false);
            goTo(index + 1);
          }}
        />
      ) : null}

      {success ? <SuccessBanner title={success} /> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="setup-dialog-toolbar">
        {index > 0 ? (
          <button type="button" className="btn-secondary" onClick={() => goTo(index - 1)}>
            {t("common.previous")}
          </button>
        ) : null}
        {index < lastIndex ? (
          <button type="button" disabled={!canAdvance || busy} onClick={() => void goNext()}>
            {busy && stepId === "deviceType" ? t("common.saving") : t("common.next")}
          </button>
        ) : null}
        {canSkip && index < lastIndex ? (
          <button type="button" className="btn-ghost" onClick={() => goTo(index + 1)}>
            {t("common.skip")}
          </button>
        ) : null}
        {props.embedded ? (
          <button type="button" className="btn-secondary" onClick={defer}>
            {t("common.close")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
