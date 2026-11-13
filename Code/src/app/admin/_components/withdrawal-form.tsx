"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput, majorStringToMinorString } from "@/app/_components/money-input";
import { Overlay, OverlayFooter } from "@/app/_components/overlay";
import { useLocale, useT } from "@/i18n/provider";

export function WithdrawalForm(props: {
  branchId: string;
  currency: string;
  triggerClassName?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const titleId = useId();
  const amountId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountMajor, setAmountMajor] = useState("");
  const [description, setDescription] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function submit() {
    const trimmed = description.trim();
    if (!trimmed || busy) return;
    let amountMinor: string;
    try {
      amountMinor = majorStringToMinorString(amountMajor, props.currency);
    } catch {
      setError(t("common.error"));
      return;
    }
    if (BigInt(amountMinor) <= 0n) {
      setError(t("apiError.expenseAmountNotPositive"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/finance/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {
        branchId: props.branchId,
        amountMinor,
        currency: props.currency,
        description: trimmed,
      },
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setAmountMajor("");
      setDescription("");
      router.refresh();
      return;
    }
    setError(apiErrorText(result, locale));
  }

  return (
    <>
      <button type="button" className={props.triggerClassName ?? "btn"} onClick={() => setOpen(true)}>
        {t("expenses.withdraw")}
      </button>
      {open ? (
        <Overlay kind="dialog" labelledBy={titleId} size="sm" onClose={close}>
          <h2 id={titleId}>{t("expenses.withdrawTitle")}</h2>
          <p>{t("expenses.withdrawHint")}</p>
          <FormField htmlFor={amountId} label={t("expenses.amount")} {...(error ? { error } : {})}>
            <MoneyInput
              id={amountId}
              currency={props.currency}
              valueMajor={amountMajor}
              onChange={setAmountMajor}
              required
            />
          </FormField>
          <FormField htmlFor={descriptionId} label={t("expenses.whatBought")}>
            <textarea
              id={descriptionId}
              name="description"
              rows={3}
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <OverlayFooter>
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || description.trim().length === 0 || amountMajor.trim().length === 0}
              onClick={() => void submit()}
            >
              {busy ? t("common.working") : t("expenses.submit")}
            </button>
          </OverlayFooter>
        </Overlay>
      ) : null}
    </>
  );
}
