"use client";

import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput, majorStringToMinorString } from "@/app/_components/money-input";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useT, useLocale } from "@/i18n/provider";
import { shouldShowBranchPicker, soleBranchId } from "@/modules/gaming/branch-selection";

type DuplicateWarning = { code: string; customerId: string; displayName: string };

export function CustomerCreateForm(props: {
  branches: Array<{ id: string; code: string; name: string }>;
  currency: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<DuplicateWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [openingMajor, setOpeningMajor] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = {
      displayName: String(data.get("displayName") ?? "").trim(),
    };
    const optional = ["phone", "notes", "createdBranchId"] as const;
    for (const key of optional) {
      const value = String(data.get(key) ?? "").trim();
      if (value) body[key] = value;
    }
    const openingSide = String(data.get("openingSide") ?? "");
    if (openingMajor.trim()) {
      try {
        const openingAmountMinor = majorStringToMinorString(openingMajor, props.currency);
        if (openingAmountMinor !== "0") {
          body.openingAmountMinor = openingAmountMinor;
          if (openingSide === "DEBTOR" || openingSide === "CREDITOR") body.openingSide = openingSide;
        }
      } catch {
        setError(t("customers.ledgerAmountInvalid"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    const result = await apiRequest("/api/customers", { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result, locale));
      return;
    }
    const payload = result.body as { warnings?: DuplicateWarning[] } | null;
    const nextWarnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
    form.reset();
    setOpeningMajor("");
    setWarnings(nextWarnings);
    router.refresh();
  }

  const nameId = `${formId}-displayName`;
  const phoneId = `${formId}-phone`;
  const notesId = `${formId}-notes`;
  const openingId = `${formId}-opening`;
  const branchFieldId = `${formId}-createdBranchId`;
  const onlyBranchId = soleBranchId(props.branches);

  return (
    <form className="stack" onSubmit={onSubmit}>
      <p>{t("customers.createHint")}</p>
      <FormField htmlFor={nameId} label={t("customers.displayName")}>
        <input
          id={nameId}
          name="displayName"
          type="text"
          required
          maxLength={200}
          placeholder={t("customers.displayNamePlaceholder")}
        />
      </FormField>
      <fieldset>
        <legend>{t("customers.openingSide")}</legend>
        <label>
          <input type="radio" name="openingSide" value="DEBTOR" defaultChecked />
          {t("customers.openingDebtor")}
        </label>
        <label>
          <input type="radio" name="openingSide" value="CREDITOR" />
          {t("customers.openingCreditor")}
        </label>
      </fieldset>
      <FormField htmlFor={openingId} label={t("customers.openingAmount")} optional>
        <MoneyInput
          id={openingId}
          currency={props.currency}
          valueMajor={openingMajor}
          onChange={setOpeningMajor}
          optional
        />
      </FormField>
      <FormField htmlFor={phoneId} label={t("customers.phone")} optional>
        <input id={phoneId} name="phone" type="text" placeholder="+963…" />
      </FormField>
      <FormField htmlFor={notesId} label={t("customers.notes")} optional>
        <textarea id={notesId} name="notes" rows={3} />
      </FormField>
      {shouldShowBranchPicker(props.branches.length) ? (
        <FormField htmlFor={branchFieldId} label={t("customers.createdAtBranch")} optional>
          <select id={branchFieldId} name="createdBranchId" defaultValue="">
            <option value="">{t("common.dash")}</option>
            {props.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : onlyBranchId ? (
        <input type="hidden" name="createdBranchId" value={onlyBranchId} />
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? t("common.working") : t("customers.createSubmit")}
      </button>
      {error ? <p className="error">{error}</p> : null}
      {warnings.length > 0 ? (
        <p className="notice">
          {t("customers.createdDuplicate", {
            matches: warnings.map((warning) => `${warning.code} (${warning.displayName})`).join("; "),
          })}
        </p>
      ) : null}
    </form>
  );
}
