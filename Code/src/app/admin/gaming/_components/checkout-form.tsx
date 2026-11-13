"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { MoneyInput, majorStringToMinorString, minorStringToMajorString } from "@/app/_components/money-input";
import { FormField } from "@/app/_components/form-field";
import { useT, useLocale } from "@/i18n/provider";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { paymentMethodLabel } from "@/i18n/payment-method";

type Method = {
  code: string;
  name: string;
  methodType: string;
  requiresReference: boolean;
  recordingMode: string;
  integration: string;
};

export function CheckoutPaymentForm(props: {
  sessionId: string;
  remainingMinor: string;
  currency: string;
  methods: Method[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const amountId = useId();
  const methodId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [methodCode, setMethodCode] = useState(props.methods[0]?.code ?? "CASH");
  const [amountMajor, setAmountMajor] = useState(() =>
    minorStringToMajorString(props.remainingMinor, props.currency),
  );
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amountMinor: string;
    try {
      amountMinor = majorStringToMinorString(amountMajor, props.currency);
    } catch {
      setError(t("common.error"));
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/gaming/sessions/${props.sessionId}/payments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: {
        amountMinor,
        currency: props.currency,
        paymentMethodCode: methodCode,
      },
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <FormField
        htmlFor={amountId}
        label={t("checkout.amount")}
        {...(error ? { error } : {})}
        help={{
          title: t("checkout.amount"),
          what: t("checkout.description"),
          choose: t("checkout.remaining"),
          example: `${t("checkout.remaining")}: ${formatMinorAmountForDisplay(props.remainingMinor, props.currency, locale)}`,
        }}
      >
        <MoneyInput
          id={amountId}
          currency={props.currency}
          valueMajor={amountMajor}
          onChange={setAmountMajor}
          required
        />
      </FormField>
      <FormField htmlFor={methodId} label={t("checkout.method")}>
        <select
          id={methodId}
          name="paymentMethodCode"
          value={methodCode}
          onChange={(event) => setMethodCode(event.target.value)}
        >
          {props.methods.map((method) => (
            <option key={method.code} value={method.code}>
              {paymentMethodLabel(method.code, locale, method.name)}
            </option>
          ))}
        </select>
      </FormField>
      <button type="submit" disabled={busy || props.methods.length === 0}>
        {busy ? t("common.working") : t("checkout.recordPayment")}
      </button>
    </form>
  );
}
