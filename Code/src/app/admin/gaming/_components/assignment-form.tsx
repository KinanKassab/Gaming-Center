"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { BranchSelectField } from "@/app/_components/branch-select-field";
import { useT, useLocale } from "@/i18n/provider";

type ScopeType = "ORGANIZATION" | "BRANCH" | "AREA" | "DEVICE_TYPE" | "DEVICE";

export function PricingAssignmentForm(props: {
  plans: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
  areas: Array<{ id: string; branchId: string; code: string; name: string }>;
  devices: Array<{ id: string; branchId: string; code: string; name: string }>;
  deviceTypes: Array<{ id: string; code: string; name: string }>;
  onSuccess?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [scopeType, setScopeType] = useState<ScopeType>("ORGANIZATION");
  const [branchId, setBranchId] = useState(props.branches[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const areas = useMemo(
    () => props.areas.filter((row) => row.branchId === branchId),
    [props.areas, branchId],
  );
  const devices = useMemo(
    () => props.devices.filter((row) => row.branchId === branchId),
    [props.devices, branchId],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = {
      pricingPlanId: String(data.get("pricingPlanId") ?? ""),
      scopeType,
      priority: String(data.get("priority") ?? "0"),
    };
    if (scopeType === "BRANCH") body.branchId = branchId;
    if (scopeType === "AREA" || scopeType === "DEVICE") {
      body.branchId = branchId;
      body.scopeId = String(data.get("scopeId") ?? "");
    }
    if (scopeType === "DEVICE_TYPE") body.scopeId = String(data.get("scopeId") ?? "");
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/gaming/pricing-assignments", { method: "POST", body });
    setBusy(false);
    if (result.ok) {
      form.reset();
      props.onSuccess?.();
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  if (props.plans.length === 0) {
    return <p>{t("pricing.empty")}</p>;
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>
        {t("pricing.plans")}
        <select name="pricingPlanId" required>
          {props.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("pricing.scope")}
        <select
          name="scopeType"
          value={scopeType}
          onChange={(event) => setScopeType(event.target.value as ScopeType)}
        >
          <option value="ORGANIZATION">{t("scope.ORGANIZATION")}</option>
          <option value="BRANCH">{t("scope.BRANCH")}</option>
          <option value="AREA">{t("scope.AREA")}</option>
          <option value="DEVICE_TYPE">{t("scope.DEVICE_TYPE")}</option>
          <option value="DEVICE">{t("scope.DEVICE")}</option>
        </select>
      </label>
      {scopeType === "BRANCH" || scopeType === "AREA" || scopeType === "DEVICE" ? (
        <BranchSelectField
          branches={props.branches}
          label={t("dashboard.branch")}
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          required
        />
      ) : null}
      {scopeType === "AREA" ? (
        <label>
          {t("areas.title")}
          <select name="scopeId" required disabled={areas.length === 0}>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scopeType === "DEVICE" ? (
        <label>
          {t("scope.DEVICE")}
          <select name="scopeId" required disabled={devices.length === 0}>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scopeType === "DEVICE_TYPE" ? (
        <label>
          {t("deviceTypes.title")}
          <select name="scopeId" required>
            {props.deviceTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <details className="advanced-block">
        <summary>{t("pricing.advanced")}</summary>
        <label>
          {t("pricing.priority")}
          <input name="priority" type="number" defaultValue="0" />
        </label>
      </details>
      <button type="submit" disabled={busy}>
        {busy ? t("common.working") : t("pricing.assign")}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
