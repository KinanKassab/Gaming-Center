"use client";

import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput, majorStringToMinorString } from "@/app/_components/money-input";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useLocale, useT } from "@/i18n/provider";

export function CustomerLedgerForm(props: {
  customerId: string;
  currency: string;
  branches: Array<{ id: string; name: string }>;
  canRecordPayment: boolean;
  canRecordDrink: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const [amountMajor, setAmountMajor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onlyBranch = props.branches.length === 1 ? props.branches[0] : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("kind") ?? "");
    const description = String(data.get("description") ?? "").trim();
    const branchId = String(data.get("branchId") ?? "").trim();
    setBusy(true);
    setError(null);
    let amountMinor = "0";
    try {
      amountMinor = majorStringToMinorString(amountMajor, props.currency);
    } catch {
      setBusy(false);
      setError(t("customers.ledgerAmountInvalid"));
      return;
    }
    const result = await apiRequest(`/api/customers/${props.customerId}/ledger`, {
      method: "POST",
      body: {
        kind,
        description,
        branchId,
        amountMinor,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result, locale));
      return;
    }
    setAmountMajor("");
    form.reset();
    router.refresh();
  }

  if (!props.canRecordPayment && !props.canRecordDrink) return null;

  return (
    <form className="stack" onSubmit={onSubmit}>
      <FormField htmlFor={`${formId}-kind`} label={t("customers.ledgerKind")}>
        <select id={`${formId}-kind`} name="kind" defaultValue={props.canRecordDrink ? "DRINK" : "PAYMENT"}>
          {props.canRecordDrink ? <option value="DRINK">{t("customers.ledgerDrink")}</option> : null}
          {props.canRecordPayment ? <option value="PAYMENT">{t("customers.ledgerPayment")}</option> : null}
        </select>
      </FormField>
      <FormField htmlFor={`${formId}-description`} label={t("customers.ledgerDescription")}>
        <input id={`${formId}-description`} name="description" type="text" required maxLength={200} />
      </FormField>
      <FormField htmlFor={`${formId}-amount`} label={t("customers.ledgerAmount")}>
        <MoneyInput
          id={`${formId}-amount`}
          currency={props.currency}
          valueMajor={amountMajor}
          onChange={setAmountMajor}
          required
        />
      </FormField>
      {onlyBranch ? (
        <input type="hidden" name="branchId" value={onlyBranch.id} />
      ) : (
        <FormField htmlFor={`${formId}-branch`} label={t("customers.createdAtBranch")}>
          <select id={`${formId}-branch`} name="branchId" required defaultValue="">
            <option value="" disabled>
              {t("common.dash")}
            </option>
            {props.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <button type="submit" disabled={busy}>
        {busy ? t("common.working") : t("customers.ledgerSubmit")}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
