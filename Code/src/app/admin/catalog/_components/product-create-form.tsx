"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput, majorStringToMinorString } from "@/app/_components/money-input";
import { useLocale, useT } from "@/i18n/provider";

export function CatalogProductCreateForm(props: { currency: string; showInventoryStatus?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const nameId = useId();
  const priceId = useId();
  const [name, setName] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amountMinor: string;
    try {
      amountMinor = majorStringToMinorString(amountMajor, props.currency);
    } catch {
      setError(t("common.error"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/catalog/products", {
      method: "POST",
      body: {
        name,
        amountMinor,
        productType: "NON_STOCK",
        trackInventory: false,
      },
    });
    setBusy(false);
    if (result.ok) {
      setName("");
      setAmountMajor("");
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <FormField htmlFor={nameId} label={t("catalog.name")}>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </FormField>
      <FormField htmlFor={priceId} label={t("catalog.price")}>
        <MoneyInput
          id={priceId}
          currency={props.currency}
          valueMajor={amountMajor}
          onChange={setAmountMajor}
          required
        />
      </FormField>
      {props.showInventoryStatus ? (
        <FormField label={t("catalog.quantity")} helper={t("catalog.inventoryUnavailable")}>
          <input value={t("catalog.inventoryNotTracked")} disabled readOnly />
        </FormField>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" disabled={busy}>
        {busy ? t("common.working") : t("catalog.create")}
      </button>
    </form>
  );
}
