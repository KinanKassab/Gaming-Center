"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { useLocale, useT } from "@/i18n/provider";
import { formatMinorAmountForDisplay } from "@/i18n/format";

type ProductOption = {
  id: string;
  name: string;
  amountMinor: string;
  currency: string;
};

export function SessionAddDrinkForm(props: {
  sessionId: string;
  products: ProductOption[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const productId = useId();
  const qtyId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(props.products[0]?.id ?? "");

  if (props.products.length === 0) {
    return <p className="hint">{t("catalog.empty")}</p>;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/gaming/sessions/${props.sessionId}/pos/orders`, {
      method: "POST",
      body: { productId: selected, quantity: "1" },
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  const current = props.products.find((row) => row.id === selected) ?? props.products[0];

  return (
    <form className="stack" onSubmit={onSubmit}>
      <FormField htmlFor={productId} label={t("catalog.pickProduct")}>
        <select
          id={productId}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {props.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {formatMinorAmountForDisplay(product.amountMinor, product.currency, locale)}
            </option>
          ))}
        </select>
      </FormField>
      <input id={qtyId} type="hidden" name="quantity" value="1" />
      {current ? (
        <p className="hint">
          {formatMinorAmountForDisplay(current.amountMinor, current.currency, locale)}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" disabled={busy || !selected}>
        {busy ? t("common.working") : t("catalog.addDrink")}
      </button>
    </form>
  );
}
